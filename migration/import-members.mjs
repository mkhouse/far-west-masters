#!/usr/bin/env node
/**
 * Import FWM members from the Airtable backup into Supabase.
 * ----------------------------------------------------------
 * Reads the local backup (never Airtable directly, so this cannot disturb the live
 * base) and upserts into `people`, keyed on the Airtable record id so it can be run
 * again safely as the base keeps changing before cutover.
 *
 * Consent state is the part that must not be got wrong. Both signals are carried
 * across — the opt-in form submission and the intro text — because FWM requires both
 * before anyone can receive bulk messages. Getting this wrong in either direction is
 * bad: too loose messages people who did not agree, too strict silently drops people
 * who did.
 *
 * Usage:
 *   node migration/import-members.mjs --dry-run     # report only, change nothing
 *   node migration/import-members.mjs
 *   node migration/import-members.mjs --backup <path-to-snapshot-dir>
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const opt = (f) => {
  const i = argv.indexOf(f)
  return i !== -1 ? argv[i + 1] : undefined
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
async function loadEnv() {
  const text = await readFile(resolve(here, '..', 'web', '.env.local'), 'utf8')
  const env = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = await loadEnv()
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SECRET) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in web/.env.local')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

/**
 * Airtable "Status" -> our person_status.
 *
 * These are operational categories for messaging, not membership records — see
 * migration 0003. All seven are preserved rather than collapsed, because the
 * distinctions are used for targeting.
 */
const STATUS_MAP = {
  'Active FWM Member': 'active_member',
  Inactive: 'inactive',
  'FWM Officers': 'officer',
  'Added by ASR import': 'asr_import',
  'Out of region racer': 'out_of_region',
  'Manual add for SMS opt-in': 'sms_opt_in',
  'Temp racer': 'temp_racer',
}

/**
 * Normalise a US phone number to E.164.
 *
 * Returns null rather than guessing when the digits do not look like a US number.
 * A malformed number that silently becomes a valid-looking one could send a
 * member's message to a stranger.
 */
function toE164(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** Airtable single-selects arrive as objects; plain values pass through. */
function selectValue(v) {
  if (v == null) return null
  return typeof v === 'object' && 'name' in v ? v.name : v
}


// ---------------------------------------------------------------------------
// Duplicate people in the source
// ---------------------------------------------------------------------------

/**
 * Status precedence when merging duplicates.
 *
 * Deliberately-assigned categories outrank `asr_import`, which is created
 * automatically by the registration import and is the usual source of the duplicate
 * in the first place.
 */
const STATUS_PRIORITY = [
  'officer',
  'active_member',
  'out_of_region',
  'sms_opt_in',
  'temp_racer',
  'inactive',
  'asr_import',
  'non_member',
]

/** Earliest of two nullable ISO timestamps. */
const earliest = (a, b) => (!a ? b : !b ? a : a < b ? a : b)

/**
 * Merge duplicate person rows into one.
 *
 * A duplicate is identified by BOTH a shared US Ski & Snowboard number AND a shared
 * phone number. Two independent identifiers agreeing is strong evidence; either
 * alone would not be, and a wrong merge attaches one person's consent to another
 * person's phone.
 *
 * Consent is merged conservatively:
 *   - suppression and opt-out win if present on ANY record, because the safe
 *     failure is not messaging someone who wanted messages, not the reverse
 *   - intro and opt-in take the EARLIEST timestamp, since consent dates from when
 *     it was first given
 *
 * Identity fields come from the highest-priority record, with gaps filled from the
 * others — the registration import often carries a birth year the member record
 * lacks.
 */
/**
 * Are these plausibly the same first name?
 *
 * Used only alongside a shared phone AND surname. Catches the diminutives the
 * registration import creates: Tim/Timothy, Ray/Raymond, Susi/Susan.
 *
 * Requires a three-character shared prefix rather than mere surname equality,
 * because "Susan Cook" and "David Cook" on one phone are a household, not a
 * duplicate — and merging them would attach one person's consent to the other.
 */
function compatibleFirstNames(a = '', b = '') {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  if (!x || !y) return false
  if (x === y) return true
  if (x.startsWith(y) || y.startsWith(x)) return true
  return x.slice(0, 3) === y.slice(0, 3)
}

function mergeDuplicates(rows) {
  const groups = new Map()

  // Strongest signal: the same person number on the same phone.
  for (const r of rows) {
    const key = r.usssa && r.phone ? `usssa:${r.usssa}|${r.phone}` : null
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  // Weaker but still reliable: the same phone and surname with compatible first
  // names. Needed because the registration import frequently creates a record with
  // no USSSA number, which the check above cannot group.
  // Only records already in a REAL group (two or more) are excluded here. A person
  // who has a USSSA number their duplicate lacks forms a group of one above, and
  // must still be visible to this pass — otherwise Tim and Timothy never meet.
  const alreadyGrouped = new Set(
    [...groups.values()]
      .filter((g) => g.length > 1)
      .flat()
      .map((r) => r.airtable_record_id)
  )
  const byPhone = new Map()
  for (const r of rows) {
    if (!r.phone || alreadyGrouped.has(r.airtable_record_id)) continue
    if (!byPhone.has(r.phone)) byPhone.set(r.phone, [])
    byPhone.get(r.phone).push(r)
  }
  for (const [phone, candidates] of byPhone) {
    if (candidates.length < 2) continue
    for (const r of candidates) {
      const match = candidates.find(
        (o) =>
          o !== r &&
          o.last_name.trim().toLowerCase() === r.last_name.trim().toLowerCase() &&
          compatibleFirstNames(o.first_name, r.first_name)
      )
      if (!match) continue
      const key = `phone:${phone}|${r.last_name.trim().toLowerCase()}`
      if (!groups.has(key)) groups.set(key, [])
      if (!groups.get(key).includes(r)) groups.get(key).push(r)
    }
  }

  const merged = []
  const absorbed = new Set()

  for (const group of groups.values()) {
    if (group.length < 2) continue

    const sorted = [...group].sort(
      (a, b) => STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status)
    )
    const primary = { ...sorted[0] }

    for (const other of sorted.slice(1)) {
      absorbed.add(other.airtable_record_id)
      primary.merged_airtable_record_ids = [
        ...(primary.merged_airtable_record_ids ?? []),
        other.airtable_record_id,
      ]

      // Suppression wins.
      primary.sms_never = primary.sms_never || other.sms_never
      primary.sms_always = primary.sms_always || other.sms_always

      // Consent dates from when it was first given.
      primary.intro_sent_at = earliest(primary.intro_sent_at, other.intro_sent_at)
      primary.opt_in_at = earliest(primary.opt_in_at, other.opt_in_at)

      // Fill gaps rather than overwrite.
      for (const field of ['yob', 'gender', 'email', 'asr_email', 'asr_phone',
                           'nickname', 'results_first_name', 'notes']) {
        if (primary[field] == null && other[field] != null) primary[field] = other[field]
      }
    }
    merged.push(primary)
  }

  const mergedIds = new Set(merged.map((m) => m.airtable_record_id))
  const out = rows
    .filter((r) => !absorbed.has(r.airtable_record_id) && !mergedIds.has(r.airtable_record_id))
    .concat(merged)

  return { rows: out, merged, absorbedCount: absorbed.size }
}

// ---------------------------------------------------------------------------
// Supabase REST helpers (plain fetch — supabase-js needs a WebSocket Node 20 lacks)
// ---------------------------------------------------------------------------
async function api(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

// ---------------------------------------------------------------------------
async function main() {
  // Find the most recent backup snapshot unless one was named.
  let snapshot = opt('--backup')
  if (!snapshot) {
    const root = resolve(here, '..', '..', 'fwm-migration-backups')
    const dirs = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && /^\d{4}-/.test(d.name))
      .map((d) => d.name)
      .sort()
    if (!dirs.length) {
      console.error(`No backup snapshots in ${root}. Run migration/airtable-backup.mjs first.`)
      process.exit(1)
    }
    snapshot = join(root, dirs[dirs.length - 1], 'texting-base')
  }
  console.log(`Backup:   ${snapshot}`)
  console.log(`Database: ${SUPABASE_URL}`)
  console.log(DRY_RUN ? 'Mode:     DRY RUN — nothing will be written\n' : 'Mode:     writing\n')

  const members = JSON.parse(await readFile(join(snapshot, 'FWM_Members.json'), 'utf8')).records
  const optIns = JSON.parse(await readFile(join(snapshot, 'Opt_in.json'), 'utf8')).records

  /**
   * Earliest opt-in submission per member.
   *
   * The form links back to member records, and some people submitted more than once.
   * The earliest submission is the one that matters: consent is dated from when it
   * was first given, not most recently repeated.
   */
  const optInAt = new Map()
  for (const sub of optIns) {
    const created = sub.fields?.Created
    for (const link of sub.fields?.['FWM Members'] ?? []) {
      const id = typeof link === 'string' ? link : link?.id
      if (!id || !created) continue
      const existing = optInAt.get(id)
      if (!existing || created < existing) optInAt.set(id, created)
    }
  }

  const rows = []
  const warnings = []

  for (const rec of members) {
    const f = rec.fields ?? {}
    const first = (f['First name'] ?? '').trim()
    const last = (f['Last name'] ?? '').trim()

    if (!first && !last) {
      warnings.push(`${rec.id}: no name — skipped`)
      continue
    }

    const rawPhone = f.Phone ?? f['ASR phone']
    const phone = toE164(rawPhone)
    if (rawPhone && !phone) {
      warnings.push(`${rec.id} ${first} ${last}: unrecognised phone "${rawPhone}" — imported without one`)
    }

    const statusLabel = selectValue(f.Status)
    const status = STATUS_MAP[statusLabel] ?? 'non_member'
    if (statusLabel && !STATUS_MAP[statusLabel]) {
      warnings.push(`${rec.id} ${first} ${last}: unknown status "${statusLabel}" — imported as non_member`)
    }

    const gender = f.Gender === 'M' || f.Gender === 'F' ? f.Gender : null

    rows.push({
      airtable_record_id: rec.id,
      first_name: first || last,
      last_name: last || first,
      nickname: f.Nickname ?? null,
      results_first_name: f['Results first name'] ?? null,
      gender,
      yob: typeof f.YOB === 'number' ? f.YOB : null,
      usssa: typeof f.USSSA === 'number' ? f.USSSA : null,
      status,
      phone,
      email: f.Email ?? null,
      asr_phone: toE164(f['ASR phone']),
      asr_email: f['ASR email'] ?? null,
      sms_always: f['Always send SMS'] === true,
      sms_never: f['Never send SMS'] === true,
      // Both consent signals. Either alone leaves the person ineligible for bulk
      // messages and visible in the opt-in review queue.
      intro_sent_at: f['Intro text sent'] ?? null,
      opt_in_at: optInAt.get(rec.id) ?? null,
      notes: f.Notes ?? null,
      merged_airtable_record_ids: [],
    })
  }

  // Fold duplicate source records together before anything is counted or written,
  // so the reported numbers describe people rather than rows.
  const { rows: deduped, merged, absorbedCount } = mergeDuplicates(rows)
  if (merged.length) {
    console.log(`Merged ${absorbedCount} duplicate record(s) into ${merged.length} people:`)
    for (const m of merged) {
      console.log(`   ${m.first_name} ${m.last_name} (USSSA ${m.usssa}) <- ${m.merged_airtable_record_ids.length} duplicate(s)`)
    }
    console.log()
  }
  rows.length = 0
  rows.push(...deduped)

  // --- report before writing ---
  const eligible = rows.filter(
    (r) => r.phone && !r.sms_never && r.intro_sent_at && r.opt_in_at
  ).length
  const byStatus = {}
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1

  console.log(`People to import: ${rows.length}`)
  for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}  ${s}`)
  }
  console.log(`\nConsent state:`)
  console.log(`   ${String(rows.filter((r) => r.phone).length).padStart(4)}  have a phone number`)
  console.log(`   ${String(rows.filter((r) => r.opt_in_at).length).padStart(4)}  opted in via the form`)
  console.log(`   ${String(rows.filter((r) => r.intro_sent_at).length).padStart(4)}  had an intro text`)
  console.log(`   ${String(eligible).padStart(4)}  ELIGIBLE for bulk messages (both signals)`)
  console.log(
    `   ${String(rows.filter((r) => r.opt_in_at && !r.intro_sent_at).length).padStart(4)}  opted in, need an intro text  -> review queue`
  )
  console.log(
    `   ${String(rows.filter((r) => r.intro_sent_at && !r.opt_in_at).length).padStart(4)}  intro sent, need the form    -> review queue`
  )
  console.log(`   ${String(rows.filter((r) => r.sms_never).length).padStart(4)}  suppressed (never send)`)

  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`)
    for (const w of warnings.slice(0, 15)) console.log(`   ${w}`)
    if (warnings.length > 15) console.log(`   ... and ${warnings.length - 15} more`)
  }

  if (DRY_RUN) {
    console.log('\nDry run — nothing written.')
    return
  }

  // Remove any rows previously written for records that are now being merged away.
  //
  // Upserting on airtable_record_id cannot do this on its own: the absorbed record
  // has a different id from the survivor, so it is left behind and then collides on
  // the unique USSSA number. This also makes the import safe to re-run after a
  // partial failure, which is exactly when it matters.
  const absorbedIds = merged.flatMap((m) => m.merged_airtable_record_ids)
  if (absorbedIds.length) {
    const list = absorbedIds.map((id) => `"${id}"`).join(',')
    await api(`people?airtable_record_id=in.(${list})`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    })
    console.log(`Removed ${absorbedIds.length} superseded duplicate row(s) if present.`)
  }

  // --- write, in batches, upserting on the Airtable id ---
  console.log('\nWriting...')
  let written = 0
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    await api('people?on_conflict=airtable_record_id', {
      method: 'POST',
      body: batch,
      prefer: 'resolution=merge-duplicates,return=minimal',
    })
    written += batch.length
    process.stdout.write(`   ${written}/${rows.length}\r`)
  }
  console.log(`   ${written}/${rows.length} done`)

  const check = await api('sms_eligible_people?select=id')
  console.log(`\nsms_eligible_people now returns ${check.length} people.`)
}

main().catch((e) => {
  console.error('\nImport failed:', e.message)
  process.exit(1)
})

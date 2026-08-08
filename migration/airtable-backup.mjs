#!/usr/bin/env node
/**
 * FWM Airtable backup / export
 * ----------------------------
 * Dumps every table in both FWM bases to JSON (authoritative) and CSV
 * (convenience) so we have a portable snapshot + seed data for the migration.
 *
 * Output goes OUTSIDE this (public) repo, because member records contain PII
 * (phone numbers, emails). Default target: ../fwm-migration-backups/
 *
 * Usage:
 *   1. Create a read-only Airtable Personal Access Token with scopes:
 *        - data.records:read
 *        - schema.bases:read
 *      granted access to both bases below.
 *   2. export AIRTABLE_PAT="pat_xxx"
 *   3. node migration/airtable-backup.mjs
 *
 * Re-run anytime for a fresh snapshot (each run writes into a timestamped folder).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const PAT = process.env.AIRTABLE_PAT
if (!PAT) {
  console.error('ERROR: set AIRTABLE_PAT (a read-only Airtable Personal Access Token).')
  process.exit(1)
}

const BASES = [
  { id: 'appdtnCaTqTFwrR3s', name: 'texting-base' },
  { id: 'appcFgDVZaMhlFhYN', name: 'results-base' },
]

// Keep backups OUT of the public repo.
const OUT_ROOT =
  process.env.FWM_BACKUP_DIR ||
  resolve(process.cwd(), '..', 'fwm-migration-backups')

const API = 'https://api.airtable.com/v0'
const headers = { Authorization: `Bearer ${PAT}` }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * GET a JSON endpoint, retrying on rate limits with a widening backoff.
 * Any non-429 error is fatal — a partial backup that looks complete is worse
 * than an obvious failure.
 */
async function api(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers })
    if (res.status === 429) {
      await sleep(1000 * (attempt + 1)) // rate limited: wait longer each try
      continue
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} for ${url}\n${await res.text()}`)
    }
    return res.json()
  }
  throw new Error(`Gave up after retries: ${url}`)
}

/** List every table in a base, so the backup discovers tables rather than hardcoding them. */
async function listTables(baseId) {
  const data = await api(`${API}/meta/bases/${baseId}/tables`)
  return data.tables.map((t) => ({ id: t.id, name: t.name }))
}

/** Fetch all records in a table, following Airtable's pagination cursor to the end. */
async function fetchAllRecords(baseId, tableId) {
  const records = []
  let offset // Airtable returns this while more pages remain
  do {
    const params = new URLSearchParams({ pageSize: '100' }) // 100 is Airtable's max
    if (offset) params.set('offset', offset)
    const data = await api(`${API}/${baseId}/${tableId}?${params}`)
    records.push(...data.records)
    offset = data.offset
    await sleep(220) // stay under Airtable's 5 requests/second limit
  } while (offset)
  return records
}

/**
 * Flatten an Airtable cell value into a CSV-safe string.
 *
 * Airtable cells are not all scalars: linked records and multi-selects arrive as
 * arrays, and selects/collaborators/attachments as objects. The JSON export keeps
 * the full structure — this is only for the human-readable CSV alongside it.
 */
function cell(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(cell).join(' | ')
  if (typeof v === 'object') {
    if ('name' in v) return String(v.name) // singleSelect / collaborator
    if ('url' in v) return String(v.url) // attachment
    return JSON.stringify(v) // anything else: keep it rather than lose it
  }
  return String(v)
}

/** Quote a CSV field only when it contains a comma, quote, or newline. */
function csvField(s) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Convert records to CSV.
 *
 * Columns are unioned across every record because Airtable omits empty fields
 * entirely — taking the first record's keys would silently drop columns.
 * Record id and creation time are prefixed with `_` to distinguish them from
 * real fields.
 */
function toCSV(records) {
  const cols = new Set()
  for (const r of records) for (const k of Object.keys(r.fields ?? {})) cols.add(k)

  const header = ['_recordId', '_createdTime', ...cols]
  const lines = [header.map(csvField).join(',')]

  for (const r of records) {
    const row = [r.id, r.createdTime ?? '', ...[...cols].map((c) => cell(r.fields?.[c]))]
    lines.push(row.map((x) => csvField(String(x))).join(','))
  }
  return lines.join('\n')
}

/** Table names become filenames, so strip anything awkward for a filesystem. */
const safe = (name) => name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')

async function main() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const runDir = join(OUT_ROOT, stamp)
  console.log(`Backing up to: ${runDir}\n`)

  const manifest = { runAt: new Date().toISOString(), bases: [] }

  for (const base of BASES) {
    const baseDir = join(runDir, base.name)
    await mkdir(baseDir, { recursive: true })
    console.log(`# ${base.name} (${base.id})`)

    const tables = await listTables(base.id)
    const baseManifest = { id: base.id, name: base.name, tables: [] }

    for (const t of tables) {
      process.stdout.write(`  - ${t.name} … `)
      const records = await fetchAllRecords(base.id, t.id)
      const fname = safe(t.name)
      await writeFile(
        join(baseDir, `${fname}.json`),
        JSON.stringify({ table: t, records }, null, 2)
      )
      await writeFile(join(baseDir, `${fname}.csv`), toCSV(records))
      console.log(`${records.length} records`)
      baseManifest.tables.push({ id: t.id, name: t.name, records: records.length })
    }
    manifest.bases.push(baseManifest)
    console.log()
  }

  await writeFile(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`Done. Manifest: ${join(runDir, 'manifest.json')}`)
}

main().catch((e) => {
  console.error('\nBackup failed:', e.message)
  process.exit(1)
})

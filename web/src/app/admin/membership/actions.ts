'use server'

/**
 * Importing a membership export from AdminSkiRacing.
 *
 * Two steps, always: preview what would change, then apply it. The preview writes
 * nothing. 161 memberships landing unseen is not something to do once, let alone
 * every few weeks through the season.
 *
 * APPLY RE-PARSES THE FILE rather than trusting the diff it was shown. The diff went
 * out to a browser and came back; re-deriving it server-side means what is applied is
 * what the file says, not what a form field claims it says.
 */

import { revalidatePath } from 'next/cache'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { missingColumns, parseAsrCsv } from '@/lib/asr-csv'
import {
  REQUIRED_COLUMNS,
  buildDiff,
  toMemberRows,
  type ExistingPerson,
  type ImportDiff,
} from '@/lib/membership-import'
import { membersForSeason } from '@/lib/membership'

export interface PreviewResult {
  ok: boolean
  error?: string
  diff?: ImportDiff
  /** The Event_id found in the file, recorded alongside the season label. */
  eventId?: string
  /** True when this season has been imported before, so the diff is incremental. */
  repeatImport?: boolean
}

export interface ApplyResult {
  ok: boolean
  error?: string
  message?: string
}

/**
 * Read the file and work out what it would do. Writes nothing.
 *
 * Any signed-in officer, not admins only: keeping the membership list current is the
 * membership director's job, and gating it behind a role they may not have would
 * mean the person responsible cannot do it.
 */
export async function previewImport(csv: string, season: string): Promise<PreviewResult> {
  await requireAppUser()
  return await analyse(csv, season)
}

/** Shared by preview and apply, so the two cannot disagree about what the file says. */
async function analyse(
  csv: string,
  season: string
): Promise<PreviewResult & { people?: ExistingPerson[] }> {
  if (!season.trim()) {
    return { ok: false, error: 'Give the season this export is for, e.g. 2025-2026.' }
  }

  const rows = parseAsrCsv(csv)
  if (rows.length === 0) {
    return { ok: false, error: 'That file has no rows in it.' }
  }

  // ASR could reasonably rename or drop a column between seasons. Saying which one
  // is missing is recoverable; importing 168 members with no identifiers is not.
  const missing = missingColumns(rows, REQUIRED_COLUMNS)
  if (missing.length > 0) {
    return {
      ok: false,
      error: `That export is missing ${missing.join(', ')}. It may be the wrong report, or ASR may have renamed a column.`,
    }
  }

  const members = toMemberRows(rows)
  const db = supabaseAdmin()

  const { data } = await db
    .from('people')
    .select('id, first_name, last_name, usssa, phone, email, opt_in_at')

  const people = (data ?? []) as unknown as ExistingPerson[]
  const currentMember = await membersForSeason(season.trim())

  const { count } = await db
    .from('membership_imports')
    .select('id', { count: 'exact', head: true })
    .eq('season', season.trim())

  return {
    ok: true,
    diff: buildDiff(members, people, currentMember),
    eventId: members[0]?.eventId,
    repeatImport: (count ?? 0) > 0,
    people,
  }
}

/**
 * Apply the import.
 *
 * Order matters: people are created or corrected first, then memberships are written
 * against them. A membership row pointing at a person who does not exist yet is the
 * one failure that would need unpicking by hand.
 */
export async function applyImport(csv: string, seasonRaw: string): Promise<ApplyResult> {
  const officer = await requireAppUser()
  const season = seasonRaw.trim()

  const analysis = await analyse(csv, season)
  if (!analysis.ok || !analysis.diff) {
    return { ok: false, error: analysis.error ?? 'Could not read that file.' }
  }

  const diff = analysis.diff
  const db = supabaseAdmin()
  const now = new Date().toISOString()

  // --- people who are not in the club yet ---
  //
  // Created, not held for review. Unlike the public opt-in form (#21), this is an
  // administrative export of people who have PAID — refusing to create them would
  // leave paying members invisible. They are listed in the preview first, so nobody
  // is created without having been seen.
  //
  // Status `asr_import` records where they came from without claiming membership;
  // membership is the row written below.
  const created = new Map<string, string>()
  for (const entry of diff.unmatched) {
    const m = entry.member
    const { data, error } = await db
      .from('people')
      .insert({
        first_name: m.firstName,
        last_name: m.lastName,
        yob: m.yob,
        gender: m.gender,
        usssa: m.usssa,
        fis: m.fis,
        phone: m.phone,
        email: m.email || null,
        asr_phone: m.phone,
        asr_email: m.email || null,
        status: 'asr_import',
      })
      .select('id')
      .single()

    // A clash on the unique USSA number means this person exists under a different
    // identity. Skip rather than abort: one odd row must not stop 160 good ones.
    if (error || !data) continue
    created.set(`${m.firstName}|${m.lastName}|${m.usssa ?? ''}`, data.id as string)
  }

  // --- contact corrections on people we already hold ---
  for (const entry of [...diff.joined, ...diff.updated]) {
    if (!entry.personId || entry.changes.length === 0) continue

    const updates: Record<string, unknown> = { updated_at: now }
    for (const change of entry.changes) updates[change.field] = change.to
    // Always record what ASR holds, separately from the working values.
    updates.asr_phone = entry.member.phone
    updates.asr_email = entry.member.email || null

    await db.from('people').update(updates).eq('id', entry.personId)
  }

  // --- the memberships themselves ---
  //
  // Upsert on (person_id, season): re-importing the same cumulative export a fortnight
  // later must change nothing for the people already in it.
  const rows = [...diff.joined, ...diff.updated]
    .filter((e) => e.personId)
    .map((e) => ({
      person_id: e.personId as string,
      season,
      event_id: e.member.eventId,
      joined_at: e.member.joinedAt,
      bib: e.member.bib,
      class: e.member.className,
      race_series: e.member.raceSeries,
      source: 'asr_import',
      updated_at: now,
    }))

  for (const entry of diff.unmatched) {
    const id = created.get(
      `${entry.member.firstName}|${entry.member.lastName}|${entry.member.usssa ?? ''}`
    )
    if (!id) continue
    rows.push({
      person_id: id,
      season,
      event_id: entry.member.eventId,
      joined_at: entry.member.joinedAt,
      bib: entry.member.bib,
      class: entry.member.className,
      race_series: entry.member.raceSeries,
      source: 'asr_import',
      updated_at: now,
    })
  }

  if (rows.length > 0) {
    const { error } = await db
      .from('memberships')
      .upsert(rows, { onConflict: 'person_id,season' })

    if (error) return { ok: false, error: `Could not write memberships: ${error.message}` }
  }

  // --- the record of the run, which the staleness warning reads ---
  await db.from('membership_imports').insert({
    season,
    event_id: analysis.eventId ?? null,
    imported_by: officer.userId,
    imported_by_label: officer.email ?? 'an officer',
    rows_in_file: diff.rowsInFile,
    members_new: diff.joined.length + created.size,
    members_updated: diff.updated.length,
    members_missing: diff.missing.length,
    people_unmatched: diff.unmatched.length,
    note:
      diff.missing.length > 0
        ? `${diff.missing.length} member(s) held for this season were absent from this export and were left alone.`
        : null,
  })

  revalidatePath('/admin/membership')
  revalidatePath('/members')
  revalidatePath('/messages/compose')

  const parts = [
    `${diff.joined.length + created.size} membership${diff.joined.length + created.size === 1 ? '' : 's'} added`,
  ]
  if (created.size > 0) parts.push(`${created.size} new people created`)
  if (diff.updated.length > 0) parts.push(`${diff.updated.length} contact detail(s) updated`)
  if (diff.unchanged > 0) parts.push(`${diff.unchanged} unchanged`)
  if (diff.missing.length > 0) {
    parts.push(`${diff.missing.length} absent from the file and left alone`)
  }

  return { ok: true, message: `${season}: ${parts.join(', ')}.` }
}

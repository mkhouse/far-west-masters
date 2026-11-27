'use server'

/**
 * Importing a race roster from AdminSkiRacing into race entries.
 *
 * Two steps, like the membership import: preview what would change, then apply
 * it. The preview writes nothing.
 *
 * APPLY RE-PARSES THE FILE rather than trusting the diff it was shown. The diff
 * went out to a browser and came back; re-deriving it server-side means what
 * lands is what the file says, not what a form field claims it says. The only
 * things taken from the client are decisions — which column is which race, and
 * which withdrawals to act on — and each is checked against what the re-derived
 * diff actually offers.
 */

import { revalidatePath } from 'next/cache'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { missingColumns, parseAsrCsv } from '@/lib/asr-csv'
import type { ExistingPerson } from '@/lib/membership-import'
import {
  ROSTER_REQUIRED_COLUMNS,
  buildRaceDiff,
  raceColumns,
  toRosterRows,
  racerIdentity,
  withdrawalKey,
  type ExistingEntry,
  type RaceColumn,
  type RaceDiff,
} from '@/lib/race-roster'

export interface RacePreview {
  ok: boolean
  error?: string
  columns?: RaceColumn[]
  /** One per race column, in file order. Keyed to a race only once mapped. */
  diffs?: RaceDiff[]
  rowsInFile?: number
}

export interface RaceApplyResult {
  ok: boolean
  error?: string
  message?: string
}

/** columnHeader -> race id. The officer's mapping, never inferred from the file. */
export type RaceMapping = Record<string, string>

async function loadPeople(): Promise<ExistingPerson[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('people')
    .select('id, first_name, last_name, usssa, phone, email, opt_in_at, asr_phone, asr_email')
  return (data ?? []) as unknown as ExistingPerson[]
}

/** Who is already entered, for the races the officer has mapped. */
async function loadExisting(raceIds: string[]): Promise<Map<string, ExistingEntry[]>> {
  const byRace = new Map<string, ExistingEntry[]>()
  if (raceIds.length === 0) return byRace

  const db = supabaseAdmin()
  const { data } = await db
    .from('race_entries')
    .select('race_id, person_id, people!inner(first_name, last_name)')
    .in('race_id', raceIds)

  for (const row of (data ?? []) as unknown as Array<{
    race_id: string
    person_id: string
    people: { first_name: string; last_name: string } | Array<{ first_name: string; last_name: string }>
  }>) {
    const p = Array.isArray(row.people) ? row.people[0] : row.people
    const list = byRace.get(row.race_id) ?? []
    list.push({
      personId: row.person_id,
      name: p ? `${p.first_name} ${p.last_name}`.trim() : 'Unknown',
    })
    byRace.set(row.race_id, list)
  }
  return byRace
}

async function analyse(csv: string, mapping: RaceMapping) {
  const rows = parseAsrCsv(csv)
  if (rows.length === 0) {
    return { ok: false as const, error: 'That file has no rows in it.' }
  }

  const missing = missingColumns(rows, ROSTER_REQUIRED_COLUMNS)
  if (missing.length > 0) {
    return {
      ok: false as const,
      error: `That export is missing ${missing.join(', ')}. It may be the wrong report, or AdminSkiRacing may have renamed a column.`,
    }
  }

  const columns = raceColumns(rows)
  if (columns.length === 0) {
    return {
      ok: false as const,
      // The race columns are what make this a roster rather than a member list.
      error:
        'No race columns in that file. A race roster has a column per race, headed like "Mammoth Season Opener GS #1 [GS] (12/31) [45]" — this looks like a different export.',
    }
  }

  const racers = toRosterRows(rows)
  const people = await loadPeople()
  const existing = await loadExisting(Object.values(mapping).filter(Boolean))

  const diffs = columns.map((column) =>
    buildRaceDiff(
      column,
      rows,
      racers,
      people,
      existing.get(mapping[column.header] ?? '') ?? []
    )
  )

  return { ok: true as const, columns, diffs, rowsInFile: rows.length }
}

/**
 * Read the file and work out what it would do. Writes nothing.
 *
 * Any signed-in officer: entering the weekend's roster is race-secretary work,
 * and gating it behind a role they may not have would mean the person
 * responsible cannot do it.
 */
export async function previewRoster(
  csv: string,
  mapping: RaceMapping = {}
): Promise<RacePreview> {
  await requireAppUser()
  return await analyse(csv, mapping)
}

/**
 * Write the entries.
 *
 * @param mapping    which race each file column belongs to
 * @param withdrawals the removals the officer left ticked, as columnHeader::personId
 */
export async function applyRoster(
  csv: string,
  mapping: RaceMapping,
  withdrawals: string[] = []
): Promise<RaceApplyResult> {
  await requireAppUser()

  const mapped = Object.entries(mapping).filter(([, raceId]) => raceId)
  if (mapped.length === 0) {
    return { ok: false, error: 'Say which race each column is before importing.' }
  }

  // A race can only be one of the columns. Two columns pointed at one race would
  // make the second one's withdrawals delete the first one's entries.
  const raceIds = mapped.map(([, id]) => id)
  if (new Set(raceIds).size !== raceIds.length) {
    return { ok: false, error: 'Two columns are pointed at the same race.' }
  }

  const analysis = await analyse(csv, mapping)
  if (!analysis.ok || !analysis.diffs) {
    return { ok: false, error: analysis.error ?? 'Could not read that file.' }
  }

  const db = supabaseAdmin()
  const now = new Date().toISOString()
  const accepted = new Set(withdrawals)

  let entriesAdded = 0
  let removed = 0
  let created = 0

  /**
   * Temp racers created during THIS apply, keyed by identity.
   *
   * Across races, not within one. A temp racer entered on both days of a
   * weekend appears in both columns' `tempRacers`, and the diffs were built
   * before any of them existed — so without this the second race would insert
   * the same human again. Where they have a USSA number the unique index would
   * reject it and they would silently miss the second race; where they have
   * none, nothing would stop a second record being made for one person.
   */
  const createdByIdentity = new Map<string, string>()

  for (const diff of analysis.diffs) {
    const raceId = mapping[diff.column.header]
    if (!raceId) continue

    // --- entrants who are not in the club ---
    //
    // Created, not held back. Temp racers and skiers from other divisions enter
    // Far West races, so an entrant matching nobody is ordinary. Status
    // `temp_racer` records what they are without claiming membership; they are
    // listed in full in the preview, so nobody is created unseen.
    //
    // They cannot be texted — nothing creates an opt-in — so this is about the
    // entry list being complete, not about reaching them.
    const personIds: string[] = diff.newEntries
      .map((e) => e.personId)
      .filter((id): id is string => !!id)

    for (const entrant of diff.tempRacers) {
      const r = entrant.racer

      const identity = racerIdentity(r)
      const already = createdByIdentity.get(identity)
      if (already) {
        personIds.push(already)
        continue
      }

      const { data, error } = await db
        .from('people')
        .insert({
          first_name: r.firstName,
          last_name: r.lastName,
          yob: r.yob,
          gender: r.gender,
          usssa: r.usssa,
          fis: r.fis,
          phone: r.phone,
          email: r.email || null,
          status: 'temp_racer',
        })
        .select('id')
        .single()

      // A clash on the unique USSA number means this person exists under another
      // identity. Skip rather than abort: one odd row must not stop forty good
      // ones, and the preview listed them for exactly this reason.
      if (error || !data) continue
      created++
      createdByIdentity.set(identity, data.id as string)
      personIds.push(data.id as string)
    }

    if (personIds.length > 0) {
      // Upsert on the existing UNIQUE (race_id, person_id): re-importing the
      // same roster is then a no-op rather than a duplicate-key failure.
      const { error } = await db.from('race_entries').upsert(
        personIds.map((person_id) => ({
          race_id: raceId,
          person_id,
          source: 'asr_roster',
          imported_at: now,
        })),
        { onConflict: 'race_id,person_id', ignoreDuplicates: true }
      )
      if (error) return { ok: false, error: `Could not write entries: ${error.message}` }
      entriesAdded += personIds.length
    }

    // --- withdrawals ---
    //
    // Only the ones still offered by the re-derived diff, and only the ones the
    // officer left ticked. A key naming somebody the file still has entered is
    // ignored rather than obeyed.
    const toRemove = diff.withdrawn
      .filter((w) => accepted.has(withdrawalKey(diff.column.header, w.personId)))
      .map((w) => w.personId)

    if (toRemove.length > 0) {
      const { error } = await db
        .from('race_entries')
        .delete()
        .eq('race_id', raceId)
        .in('person_id', toRemove)
      if (error) return { ok: false, error: `Could not remove entries: ${error.message}` }
      removed += toRemove.length
    }
  }

  revalidatePath('/admin/entries')
  revalidatePath('/messages/compose')

  const parts = [`${entriesAdded} ${entriesAdded === 1 ? 'entry' : 'entries'} recorded`]
  if (created > 0) parts.push(`${created} temp ${created === 1 ? 'racer' : 'racers'} created`)
  if (removed > 0) parts.push(`${removed} withdrawn`)

  return { ok: true, message: `${parts.join(', ')}.` }
}

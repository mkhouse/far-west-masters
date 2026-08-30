'use server'

/**
 * Apply a schedule import.
 *
 * Admin only, unlike templates. Races are what results attach to and what standings
 * are computed from, so this is closer to the groups screen than to editing wording.
 *
 * The order matters, and mirrors the send action: authorise, re-read the source,
 * re-build the diff on the server, then write. Nothing about what to write is taken
 * from the browser — the form carries the season and the source, and the server works
 * out the rest again. A preview left open while somebody edited the page must not be
 * able to apply what it was showing.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseSchedule } from '@/lib/schedule-parse'
import {
  buildScheduleDiff,
  scheduleFingerprint,
  type ExistingRace,
} from '@/lib/schedule-import'
import { fromArchive, fromLive, type SourceKind } from '@/lib/schedule-source'

/** Key in app_settings recording what was last imported, per season. */
const fingerprintKey = (season: string) => `schedule_import_${season}`

async function loadSource(kind: SourceKind, season: string, pasted: string) {
  if (kind === 'pasted') {
    if (!pasted.trim()) throw new Error('Nothing was pasted.')
    return { kind, html: pasted, description: 'pasted HTML' } as const
  }
  if (kind === 'live') return fromLive()

  const archived = await fromArchive(season)
  if (!archived) throw new Error(`No archived schedule for ${season}.`)
  return archived
}

/** Races already on file for a season, with whether each carries results. */
export async function existingRacesFor(seasonId: string): Promise<ExistingRace[]> {
  const db = supabaseAdmin()

  // Shape declared explicitly, the same as the groups page: a select built from a
  // concatenated string defeats Supabase's inferred types, and an unchecked `any`
  // here would hide a genuine mistake in the column list.
  interface RaceRow {
    id: string
    date: string
    discipline: ExistingRace['discipline']
    venue: string | null
    name: string
    status: string
    counts_toward_standings: boolean
    live_timing_id: number | null
    usssa_race_code: string | null
    notes: string | null
  }

  const { data } = await db
    .from('races')
    .select(
      'id, date, discipline, venue, name, status, counts_toward_standings, ' +
        'live_timing_id, usssa_race_code, notes'
    )
    .eq('season_id', seasonId)

  const races = (data ?? []) as unknown as RaceRow[]
  if (!races.length) return []

  // Which of them have results. One query rather than one per race, and it decides
  // whether a change is applied or held for a decision — so it is worth getting from
  // the database rather than inferring from the race's status.
  const { data: withResults } = await db
    .from('results')
    .select('race_id')
    .in(
      'race_id',
      races.map((r) => r.id)
    )

  const hasResults = new Set(
    ((withResults ?? []) as unknown as Array<{ race_id: string }>).map((r) => r.race_id)
  )

  return races.map((r) => ({
    id: r.id,
    date: r.date,
    discipline: r.discipline,
    venue: r.venue,
    name: r.name,
    status: r.status,
    countsTowardStandings: r.counts_toward_standings,
    liveTimingId: r.live_timing_id,
    usssaRaceCode: r.usssa_race_code,
    notes: r.notes,
    hasResults: hasResults.has(r.id),
  }))
}

/**
 * Create the season a schedule belongs to.
 *
 * Deliberately WITHOUT scoring rules. `best_n` and `points_scale` are `not null`, so
 * something has to go in them; a placeholder that is obviously unset is safer than a
 * guess copied from last season, because a wrong best-N produces standings that look
 * right and are not. `best_n = 0` and an empty scale mean "not set yet", the screen
 * says so, and `rules_verified` stays false.
 *
 * Nothing is scored until an admin fills them in.
 */
export async function createSeason(formData: FormData) {
  await requireAppUser('admin')
  const season = String(formData.get('season') ?? '')
  const makeActive = formData.get('make_active') === 'on'

  const fail = (msg: string) =>
    redirect(`/admin/schedule?error=${encodeURIComponent(msg)}`)

  if (!/^\d{4}-\d{4}$/.test(season)) return fail(`“${season}” is not a season label.`)

  const db = supabaseAdmin()
  const year = Number(season.split('-')[1])

  const { error } = await db.from('seasons').insert({
    name: season,
    year,
    best_n: 0,
    points_scale: [],
    rules_verified: false,
    active: false,
  })

  if (error && error.code !== '23505') {
    return fail(`Could not create ${season}: ${error.message}`)
  }

  if (makeActive) await activateSeason(season)

  revalidatePath('/admin/schedule')
  redirect(`/admin/schedule?season=${season}&created=1`)
}

/**
 * Move the active flag.
 *
 * Two statements rather than one because `seasons_one_active_idx` is a unique partial
 * index: setting the new one active while the old still is would violate it. Clearing
 * first is the only order that works.
 *
 * This matters more than it looks. Everything that asks "which season is it" reads
 * this flag — including the venue picker in message templates, which silently shows
 * nothing when the active season has no upcoming races. Leaving it on last season
 * presents as a feature being broken.
 */
async function activateSeason(season: string) {
  const db = supabaseAdmin()
  await db.from('seasons').update({ active: false }).eq('active', true)
  await db.from('seasons').update({ active: true }).eq('name', season)
}

export async function setActiveSeason(formData: FormData) {
  await requireAppUser('admin')
  const season = String(formData.get('season') ?? '')
  if (!/^\d{4}-\d{4}$/.test(season)) return

  await activateSeason(season)
  revalidatePath('/admin/schedule')
  revalidatePath('/messages/compose')
  redirect(`/admin/schedule?season=${season}&activated=1`)
}

/**
 * Write the import.
 *
 * What this never does, and each has cost somebody a season somewhere:
 *
 *   * Delete a race. A race missing from the page is listed and left alone — results
 *     hang off races, and a web page dropping a row is not evidence a race did not
 *     happen.
 *   * Touch `live_timing_id`, `usssa_race_code` or `notes`. All hand-entered, none
 *     recoverable from the page.
 *   * Change a race that has results. Held as a conflict for an admin to act on by
 *     hand, because that is a published standing being rewritten.
 *   * Apply an empty parse. A restructured page and "every race was cancelled" look
 *     identical from here.
 */
export async function applySchedule(formData: FormData) {
  await requireAppUser('admin')

  const season = String(formData.get('season') ?? '')
  const kind = String(formData.get('source') ?? 'archive') as SourceKind
  const pasted = String(formData.get('pasted') ?? '')

  const back = (params: string) =>
    redirect(`/admin/schedule?season=${season}&source=${kind}&${params}`)

  const db = supabaseAdmin()

  const { data: seasonRow } = await db
    .from('seasons')
    .select('id')
    .eq('name', season)
    .maybeSingle()

  if (!seasonRow) {
    return back(`error=${encodeURIComponent(`${season} does not exist yet.`)}`)
  }

  let source
  try {
    source = await loadSource(kind, season, pasted)
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message)}`)
  }

  // Re-parsed and re-diffed here. The preview is a rendering of this same
  // computation, never an input to it.
  const { races, warnings } = parseSchedule(source.html, season)
  const existing = await existingRacesFor(seasonRow.id as string)
  const diff = buildScheduleDiff(races, existing, { season, warnings })

  if (diff.empty) {
    return back(
      `error=${encodeURIComponent(
        'No races were found on that page, so nothing was applied. Either the page ' +
          'has changed shape or the wrong source was chosen — an empty result is not ' +
          'treated as “remove everything”.'
      )}`
    )
  }

  if (diff.toAdd.length) {
    const { error } = await db.from('races').insert(
      diff.toAdd.map((r) => ({
        season_id: seasonRow.id,
        name: r.name,
        slug: r.slug,
        date: r.date,
        venue: r.venue,
        discipline: r.discipline,
        factor: r.factor,
        run_count: r.runCount,
        status: r.status,
        series: r.series,
        counts_toward_standings: r.countsTowardStandings,
        notes: r.notes,
      }))
    )

    if (error) {
      return back(
        `error=${encodeURIComponent(`Could not add races: ${error.message}`)}`
      )
    }
  }

  // Only the fields the page is authoritative for. Note the absence of date and
  // discipline: a race whose date moved is a different race on the page, and comes
  // through as an addition plus a row left alone, which is visible rather than
  // silent.
  for (const entry of diff.toChange) {
    const patch: Record<string, unknown> = {}
    for (const change of entry.changes) {
      if (change.field === 'status') patch.status = change.to
      if (change.field === 'counts toward standings') {
        patch.counts_toward_standings = change.to === 'true'
      }
    }
    if (Object.keys(patch).length) {
      await db.from('races').update(patch).eq('id', entry.existing.id)
    }
  }

  // Record what was imported, so the screen can say later whether the page has
  // changed since. Stored after a successful write, never before.
  await db.from('app_settings').upsert(
    {
      key: fingerprintKey(season),
      value: scheduleFingerprint(source.html),
      description: `Fingerprint of the ${season} schedule at its last import.`,
    },
    { onConflict: 'key' }
  )

  revalidatePath('/admin/schedule')
  revalidatePath('/messages/compose')

  back(
    `added=${diff.toAdd.length}&changed=${diff.toChange.length}` +
      `&conflicts=${diff.conflicts.length}`
  )
}

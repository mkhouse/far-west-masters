import 'server-only'

/**
 * Who is a member, and whether we still believe it.
 *
 * Membership is a row in `memberships` keyed by season, not a value on the person.
 * That is what makes annual renewal work without anything running: on 1 September
 * the season label rolls over, nobody holds a row for the new one, and everybody is
 * correctly not-a-member until they renew and the next import picks them up.
 *
 * The pure decisions live in this file's exported helpers so they can be tested;
 * the queries are thin wrappers around them.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { daysSince, isInSeason, seasonFor } from '@/lib/season'

export interface SeasonSettings {
  membershipYearStart: string
  seasonStart: string
  seasonEnd: string
  maxImportAgeDays: number
}

const DEFAULTS: SeasonSettings = {
  membershipYearStart: '09-01',
  seasonStart: '10-15',
  seasonEnd: '04-01',
  maxImportAgeDays: 14,
}

export async function seasonSettings(): Promise<SeasonSettings> {
  const { data } = await supabaseAdmin().from('app_settings').select('key, value')
  const get = (k: string, d: string) => data?.find((r) => r.key === k)?.value ?? d

  return {
    membershipYearStart: get('membership_year_start', DEFAULTS.membershipYearStart),
    seasonStart: get('season_start', DEFAULTS.seasonStart),
    seasonEnd: get('season_end', DEFAULTS.seasonEnd),
    maxImportAgeDays:
      Number(get('membership_import_max_age_days', String(DEFAULTS.maxImportAgeDays))) ||
      DEFAULTS.maxImportAgeDays,
  }
}

export interface DisplaySeason {
  /** The season whose memberships are being shown. */
  season: string
  /** The season we are actually in, which may differ. */
  currentSeason: string
  /** True when showing an older season because the current one has no import yet. */
  isFallback: boolean
}

/**
 * Which season's memberships to show.
 *
 * Strictly, from 1 September nobody is a member until the first import of the new
 * season — true, and it would leave the directory apparently empty from September
 * until renewals are imported in late October or later. That reads as broken.
 *
 * So it falls back to the most recent season that HAS an import, and says so. Honest
 * about which year is on screen, without six weeks of an apparently empty club.
 * Melissa chose this over showing a blunt zero (2026-08-16).
 *
 * Season labels sort correctly as strings in the club's "2025-2026" format, so the
 * most recent is simply the last one.
 */
export function displaySeason(
  currentSeason: string,
  importedSeasons: string[]
): DisplaySeason {
  if (importedSeasons.includes(currentSeason)) {
    return { season: currentSeason, currentSeason, isFallback: false }
  }

  const mostRecent = [...importedSeasons].sort().pop()

  // Nothing has ever been imported: show the current season, which will simply be
  // empty. There is nothing to fall back to and nothing to explain.
  if (!mostRecent) return { season: currentSeason, currentSeason, isFallback: false }

  return { season: mostRecent, currentSeason, isFallback: true }
}

export interface ImportFreshness {
  /** Say something to the officer. */
  stale: boolean
  /** Null when nothing has ever been imported for the season being shown. */
  lastImportedAt: string | null
  daysOld: number | null
  season: string
  currentSeason: string
  isFallback: boolean
}

/**
 * Whether the membership data is old enough to mention.
 *
 * Only in season. People join throughout it, so a fortnight-old import means new
 * members are missing from the directory and from every audience — and the failure
 * is silent, which is the whole reason for saying anything. Out of season nothing
 * changes and a warning nobody needs is one people learn to ignore.
 */
export function assessFreshness(
  now: Date,
  settings: SeasonSettings,
  display: DisplaySeason,
  lastImportedAt: string | null
): ImportFreshness {
  const base = {
    lastImportedAt,
    season: display.season,
    currentSeason: display.currentSeason,
    isFallback: display.isFallback,
  }

  if (!isInSeason(now, settings.seasonStart, settings.seasonEnd)) {
    return { ...base, stale: false, daysOld: null }
  }

  // In season with nothing imported for the current season at all. That is the most
  // important case, not the least: it is what happens if the first import of the
  // year is forgotten.
  if (!lastImportedAt || display.isFallback) {
    return { ...base, stale: true, daysOld: null }
  }

  const daysOld = daysSince(new Date(lastImportedAt), now)
  return { ...base, stale: daysOld > settings.maxImportAgeDays, daysOld }
}

/** Everything the directory and the banner need, in one round trip each. */
export async function membershipContext(now = new Date()): Promise<{
  settings: SeasonSettings
  display: DisplaySeason
  freshness: ImportFreshness
}> {
  const db = supabaseAdmin()
  const settings = await seasonSettings()
  const currentSeason = seasonFor(now, settings.membershipYearStart)

  const { data: imports } = await db
    .from('membership_imports')
    .select('season, imported_at')
    .order('imported_at', { ascending: false })

  const rows = (imports ?? []) as Array<{ season: string; imported_at: string }>
  const display = displaySeason(currentSeason, [...new Set(rows.map((r) => r.season))])
  const lastForShown = rows.find((r) => r.season === display.season)?.imported_at ?? null

  return {
    settings,
    display,
    freshness: assessFreshness(now, settings, display, lastForShown),
  }
}

/** Person ids holding a membership for a season. */
export async function membersForSeason(season: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin()
    .from('memberships')
    .select('person_id')
    .eq('season', season)

  return new Set((data ?? []).map((r) => r.person_id as string))
}

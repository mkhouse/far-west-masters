import 'server-only'

/**
 * The races still to come in the current season.
 *
 * Templates say things like "meet me between {time} at {venue}" and "any thoughts
 * about racing at {venue} next weekend?". Typing the resort each time is how "Palisades
 * Tahoe", "Palisades" and "Squaw" end up in three different texts about one race, so
 * where the schedule knows the answer the officer should be picking rather than
 * typing.
 *
 * The schedule has no admin screen yet (#6) — rows arrive by SQL. That is exactly why
 * every caller has to cope with an empty list: an officer must never be blocked from
 * sending a message because a table nobody can edit in the app happens to be empty.
 * The picker degrades to a text box, and says why.
 */

import { supabaseAdmin } from './supabase/admin'

export interface UpcomingRace {
  id: string
  /** The resort, which is what goes into a message. Falls back to the race name. */
  venue: string
  /** 'Alpine SL - March 06, 2026 (1 of 2)' — for telling two races apart in a list. */
  name: string
  /** ISO date, 'YYYY-MM-DD'. */
  date: string
  series: string | null
}

/**
 * Format a race date for a picker label.
 *
 * Built from the string, NOT from `new Date(iso)`. A date column has no time, so
 * parsing it yields UTC midnight, and formatting that in Pacific time renders the day
 * before — a race on the 14th listed as the 13th. That bug is invisible in summer
 * testing on a UTC machine and wrong all winter for everybody actually using this.
 */
export function formatRaceDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return iso

  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  // Date.UTC keeps the weekday calculation in the same frame as the parts above.
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ]
  return `${weekday} ${day} ${MONTHS[month - 1]}`
}

/** "Palisades Tahoe — Sat 14 Feb", for a dropdown. */
export function raceLabel(race: UpcomingRace): string {
  return `${race.venue} — ${formatRaceDate(race.date)}`
}

/**
 * Races in the active season that have not happened yet.
 *
 * Cancelled races are excluded — inviting somebody to a race that is off is worse
 * than making them type the venue. Races already run are excluded too: this list
 * exists to answer "which race am I texting about", and that is always one ahead.
 *
 * @param today ISO 'YYYY-MM-DD'. Injected so the boundary is testable rather than
 *              depending on when the suite happens to run.
 */
export async function upcomingRaces(today?: string): Promise<UpcomingRace[]> {
  const db = supabaseAdmin()

  const { data: season } = await db
    .from('seasons')
    .select('id')
    .eq('active', true)
    .maybeSingle()

  if (!season) return []

  // Compared as a string. ISO dates sort and compare correctly as text, and going
  // through a Date would reintroduce the timezone problem formatRaceDate avoids.
  const from = today ?? new Date().toISOString().slice(0, 10)

  const { data } = await db
    .from('races')
    .select('id, name, venue, date, series')
    .eq('season_id', season.id as string)
    .gte('date', from)
    .neq('status', 'canceled')
    .order('date')

  return (data ?? []).map((r) => ({
    id: r.id as string,
    // `venue` is nullable in the schema. The race name always exists, and a name is a
    // far better thing to put in a member's text than an empty string.
    venue: ((r.venue as string | null) ?? (r.name as string)).trim(),
    name: r.name as string,
    date: r.date as string,
    series: (r.series as string | null) ?? null,
  }))
}

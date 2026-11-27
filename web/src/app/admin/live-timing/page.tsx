/**
 * Live-timing ids, looked up rather than transcribed.
 *
 * Each race needs the id live-timing gave it, because that is how its results
 * are fetched afterwards. They were going to be collected by hand; they do not
 * have to be. Live-timing publishes a static file per day listing every race it
 * hosted nationwide, so the id can be found from the date, venue and discipline
 * — see lib/live-timing.ts and migration/live-timing-format.md.
 *
 * THE OFFICER STILL CONFIRMS. A wrong id does not fail, it imports another
 * race's results under this race's name, so the suggestion is shown with the
 * race name and start time it came from rather than silently applied.
 *
 * One request per DATE, not per race, cached for a day: the schedule does not
 * move, and live-timing's file is a courtesy.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { pacificDate } from '@/lib/race-weekends'
import { fetchDailyRaces, suggestId, type DailyRace } from '@/lib/live-timing'
import { RaceIdForm } from './live-timing-form'

/**
 * How far either side of today to look ids up.
 *
 * Bounded so a page view is a handful of requests rather than one per race
 * date in the season. Past races keep their ids; the ones that need looking up
 * are the ones coming.
 */
const LOOK_BACK_DAYS = 14
const LOOK_AHEAD_DAYS = 45

export default async function LiveTimingPage() {
  await requireAppUser()
  const db = supabaseAdmin()

  const { data: season } = await db
    .from('seasons')
    .select('id, name')
    .eq('active', true)
    .maybeSingle()

  const { data: raceRows } = season
    ? await db
        .from('races')
        .select('id, name, date, venue, discipline, live_timing_id')
        .eq('season_id', season.id)
        .neq('status', 'canceled')
        .order('date')
    : { data: [] }

  const races = (raceRows ?? []) as Array<{
    id: string
    name: string
    date: string
    venue: string | null
    discipline: string
    live_timing_id: number | null
  }>

  const today = pacificDate()
  const from = shift(today, -LOOK_BACK_DAYS)
  const to = shift(today, LOOK_AHEAD_DAYS)

  // Only races in the window and still missing an id are looked up.
  const needLookup = races.filter(
    (r) => r.live_timing_id === null && r.date >= from && r.date <= to
  )

  // One fetch per distinct date. Several races on one day share it.
  const dates = [...new Set(needLookup.map((r) => r.date))]
  const byDate = new Map<string, DailyRace[]>()
  await Promise.all(
    dates.map(async (d) => {
      byDate.set(d, await fetchDailyRaces(d))
    })
  )

  /** Which race of its discipline that day — FWM names them "1 of 2". */
  const sequenceOf = (name: string): number | null => {
    const m = name.match(/\((\d+)\s*of\s*\d+\)/i)
    return m ? Number(m[1]) : null
  }

  const withSuggestions = races.map((r) => {
    const daily = byDate.get(r.date)
    const suggestion =
      r.live_timing_id === null && daily
        ? suggestId(daily, {
            venue: r.venue,
            discipline: r.discipline,
            sequence: sequenceOf(r.name),
          })
        : null
    return { race: r, suggestion }
  })

  const missing = withSuggestions.filter((w) => w.race.live_timing_id === null).length

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm">
        <Link href="/admin" className="text-neutral-600 underline">
          &larr; Admin
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">
        Live-timing ids{season ? ` · ${season.name}` : ''}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">
        How each race&rsquo;s results are fetched afterwards. Looked up from the
        date and venue where live-timing has published the day; confirmed by you
        either way, because a wrong id imports another race&rsquo;s results under
        this one&rsquo;s name.
      </p>

      {races.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-600">
          No races yet.{' '}
          <Link href="/admin/schedule" className="text-fwm-navy underline">
            Import the schedule
          </Link>{' '}
          first.
        </p>
      ) : (
        <>
          {missing > 0 && (
            <div className="mt-4 rounded-r-lg border-l-[3px] border-fwm-amber bg-fwm-amber/10 px-4 py-3 text-sm">
              <p className="font-medium text-fwm-amber-text">
                {missing} of {races.length} races have no id yet
              </p>
              {/* Melissa, 2026-11-27: "even if it's not available Monday it
                  might still be available Tuesday. I'd worry if it's not there
                  the day after registration closes." So this does NOT claim a
                  deadline — the system knows when a race is, not when its
                  registration shuts. */}
              <p className="mt-1 text-neutral-700 dark:text-neutral-300">
                Live-timing publishes a race some days ahead, and not on a fixed
                schedule — missing is ordinary until registration closes. Worth
                chasing if it is still missing the day after.
              </p>
            </div>
          )}

          <ul className="mt-6 space-y-3">
            {withSuggestions.map(({ race, suggestion }) => (
              <li
                key={race.id}
                className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800"
              >
                <p className="font-medium">
                  {race.date} &middot; {race.name}
                </p>
                <p className="mt-0.5 text-sm text-neutral-600">
                  {race.venue} &middot; {race.discipline}
                  {race.live_timing_id !== null && (
                    <>
                      {' '}
                      &middot;{' '}
                      <a
                        href={`https://www.live-timing.com/race2.php?r=${race.live_timing_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-fwm-navy underline"
                      >
                        open on live-timing
                      </a>
                    </>
                  )}
                </p>

                <RaceIdForm
                  raceId={race.id}
                  current={race.live_timing_id}
                  suggestedId={suggestion?.id ?? null}
                  reason={
                    race.live_timing_id !== null
                      ? 'Set. Clear the box and save to remove it.'
                      : (suggestion?.reason ??
                        'Outside the lookup window — enter it by hand if you have it.')
                  }
                  candidates={suggestion?.candidates ?? []}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}

/** Shift an ISO date by whole days, without a local-timezone Date. */
function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10)
}

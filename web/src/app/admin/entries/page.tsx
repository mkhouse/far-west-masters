/**
 * Importing who entered a race, from AdminSkiRacing.
 *
 * The point of this is messaging. Until race entries exist, the club can text
 * "all members" and nothing narrower — so a note about Saturday's start time
 * goes to three hundred people, most of whom are not racing, which is how an
 * audience learns to ignore the club's texts.
 *
 * One download covers a whole weekend: the roster has a column per race, and a
 * registration timestamp in that column is the entry. See lib/race-roster.ts
 * for the shape and for why an empty cell is a statement rather than a silence.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { EntriesForm, type RaceOption } from './entries-form'

export default async function RaceEntriesPage() {
  await requireAppUser()

  const db = supabaseAdmin()

  const { data: season } = await db
    .from('seasons')
    .select('id, name')
    .eq('active', true)
    .maybeSingle()

  const { data: raceRows } = await db
    .from('races')
    .select('id, name, date, discipline, venue, race_entries(count)')
    .eq('season_id', season?.id ?? '')
    .order('date', { ascending: true })

  const races: RaceOption[] = (
    (raceRows ?? []) as unknown as Array<{
      id: string
      name: string
      date: string
      discipline: string
      venue: string | null
      race_entries: Array<{ count: number }>
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    date: r.date,
    discipline: r.discipline,
    venue: r.venue,
    entryCount: r.race_entries?.[0]?.count ?? 0,
  }))

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm">
        <Link href="/admin" className="text-neutral-600 underline">
          &larr; Admin
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">Race entries</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Who has entered each race, so a message can go to the people actually
        racing rather than to the whole club.
      </p>

      {/* Said before the upload. Which download to take is the step that goes
          wrong, exactly as it is on the membership import — and this one is a
          different report with different column names from that one. */}
      <div className="mt-4 rounded-r-lg border-l-[3px] border-fwm-amber bg-fwm-amber/10 px-4 py-3 text-sm">
        <p className="font-medium">Take the Race Roster for the event</p>
        <p className="mt-1 text-neutral-700 dark:text-neutral-300">
          It saves as <code>race_roster_….csv</code> and holds the whole weekend
          — one column per race, with a registration time against everybody in
          it. Importing the same file twice changes nothing.
        </p>
      </div>

      {races.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-600">
          No races in {season?.name ?? 'the active season'} yet. Import the
          schedule first on{' '}
          <Link href="/admin/schedule" className="text-fwm-navy underline">
            Race schedule
          </Link>
          .
        </p>
      ) : (
        <EntriesForm races={races} seasonName={(season?.name as string) ?? ''} />
      )}
    </main>
  )
}

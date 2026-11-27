/**
 * Season setup — the scoring rules.
 *
 * Until these are set, `best_n` is 0 and nothing scores; the schedule screen
 * has been saying so since the season was created. This existed as a migration
 * written by hand each year, which is a lot of ceremony for the two numbers
 * that actually change.
 *
 * MOSTLY DERIVED, DELIBERATELY. Melissa, 2026-11-27: "the points scale and
 * classes will usually be unchanged, the number of races and the number that
 * count will change. The interface can be very simple." So the race counts come
 * from the schedule, best-N is computed from them by the club's published rule,
 * the scale and age groups carry forward, and the officer confirms rather than
 * transcribes.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { bestNDrifted, bestNFor } from '@/lib/season-rules'
import { SeasonForm } from './season-form'

export default async function SeasonSetupPage() {
  const appUser = await requireAppUser()
  const db = supabaseAdmin()

  const { data: season } = await db
    .from('seasons')
    .select('id, name, best_n, total_races, min_starts_for_award, points_scale, age_groups, rules_verified')
    .eq('active', true)
    .maybeSingle()

  if (!season) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm">
          <Link href="/admin" className="text-neutral-600 underline">
            &larr; Admin
          </Link>
        </p>
        <h1 className="mt-4 text-xl font-semibold">Season setup</h1>
        <p className="mt-4 text-sm text-neutral-600">
          No season is active.{' '}
          <Link href="/admin/schedule" className="text-fwm-navy underline">
            Import a schedule
          </Link>{' '}
          to create one.
        </p>
      </main>
    )
  }

  const { data: raceRows } = await db
    .from('races')
    .select('name, date, venue, counts_toward_standings')
    .eq('season_id', season.id)
    .order('date')

  const races = (raceRows ?? []) as Array<{
    name: string
    date: string
    venue: string | null
    counts_toward_standings: boolean
  }>
  const counting = races.filter((r) => r.counts_toward_standings).length
  const excluded = races.filter((r) => !r.counts_toward_standings)

  const storedBestN = (season.best_n as number) ?? 0
  const computed = bestNFor(counting)
  const drifted = bestNDrifted(storedBestN, counting)

  // The previous season's scale, shown so it is clear what carrying forward
  // actually means rather than it happening invisibly on save.
  const { data: carried } = season.points_scale
    ? { data: { points_scale: season.points_scale } }
    : await db
        .from('seasons')
        .select('points_scale')
        .not('points_scale', 'is', null)
        .neq('id', season.id)
        .order('year', { ascending: false })
        .limit(1)
        .maybeSingle()

  const scale = (carried?.points_scale as number[] | null) ?? null

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm">
        <Link href="/admin" className="text-neutral-600 underline">
          &larr; Admin
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">Season setup · {season.name}</h1>
      <p className="mt-1 text-sm text-neutral-600">
        How this season scores. Nothing scores at all until it is set.
      </p>

      {/* Amber: something is waiting for you, and nothing has gone wrong. */}
      {!season.rules_verified && (
        <div className="mt-4 rounded-r-lg border-l-[3px] border-fwm-amber bg-fwm-amber/10 px-4 py-3 text-sm">
          <p className="font-medium text-fwm-amber-text">
            {season.name} has no scoring rules yet
          </p>
          <p className="mt-1 text-neutral-700 dark:text-neutral-300">
            Races can be imported and texted about, but nothing will score until
            this is saved.
          </p>
        </div>
      )}

      {/* The reason this check exists: the published rules allow races to be
          "added to the schedule during the season", and a best-N set before
          that is wrong afterwards without anything noticing. */}
      {drifted && (
        <div className="mt-4 rounded-r-lg border-l-[3px] border-fwm-amber bg-fwm-amber/10 px-4 py-3 text-sm">
          <p className="font-medium text-fwm-amber-text">
            The schedule has changed since these rules were set
          </p>
          <p className="mt-1 text-neutral-700 dark:text-neutral-300">
            {counting} races now count toward standings, so best-N should be{' '}
            {computed} rather than the {storedBestN} saved. Save again to update it.
          </p>
        </div>
      )}

      <section className="mt-6 rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
        <h2 className="font-medium">Races</h2>
        <p className="mt-1 text-sm text-neutral-600">
          <strong className="text-foreground">{races.length}</strong> in the
          schedule &middot;{' '}
          <strong className="text-foreground">{counting}</strong> count toward
          standings.
        </p>
        {excluded.length > 0 && (
          <>
            <p className="mt-2 text-sm text-neutral-600">
              {excluded.length} {excluded.length === 1 ? 'does' : 'do'} not, and
              {excluded.length === 1 ? ' is' : ' are'} excluded from the 75%:
            </p>
            <ul className="mt-1 space-y-0.5 text-sm text-neutral-600">
              {excluded.map((r) => (
                <li key={r.name}>
                  {r.date} &middot; {r.name}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-2 text-sm text-neutral-600">
          Set by the schedule import, not here &mdash;{' '}
          <Link href="/admin/schedule" className="text-fwm-navy underline">
            Race schedule
          </Link>
          .
        </p>
      </section>

      <SeasonForm
        seasonId={season.id as string}
        bestN={storedBestN > 0 && !drifted ? storedBestN : computed}
        minStarts={(season.min_starts_for_award as number) ?? 6}
        counting={counting}
        isAdmin={appUser.role === 'admin'}
      />

      {/* Shown, not editable. Thirty numbers retyped once a year is a way to
          get one of them wrong, and these were measured rather than chosen. */}
      <section className="mt-6 rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
        <h2 className="font-medium">Carried forward, unchanged</h2>
        <dl className="mt-2 space-y-2 text-sm">
          <div>
            <dt className="text-neutral-600">Points scale</dt>
            <dd className="mt-0.5">
              {scale ? (
                <>
                  {scale.length} deep &middot; {scale.slice(0, 6).join(', ')}&hellip;{' '}
                  {scale[scale.length - 1]}
                </>
              ) : (
                <span className="text-fwm-burgundy">
                  None to carry forward — this needs a migration.
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-600">Age groups</dt>
            <dd className="mt-0.5">{String(season.age_groups).replace('_', '-')}</dd>
          </div>
        </dl>
        <p className="mt-2 text-sm text-neutral-600">
          The scale was measured from the club&rsquo;s own published standings,
          not copied from the rules sheet, which abbreviates it. Changing either
          of these is rare enough to be a migration.
        </p>
      </section>
    </main>
  )
}

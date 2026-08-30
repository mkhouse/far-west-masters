/**
 * Import the race schedule.
 *
 * Preview then apply, the same shape as the membership import — and for the same
 * reason. The preview writes nothing, so the cost of looking is zero, and the cost of
 * a wrong import is a season of standings.
 *
 * The preview lists every race it would create rather than counting them. That is
 * deliberate: the parser can be confidently wrong. If the club ever changes what
 * 'SL / SL' means over a two-day range, nothing errors — it simply imports half the
 * races. A count of 19 looks fine; "2 races at Sugar Bowl" when you know there were
 * four does not.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { parseSchedule } from '@/lib/schedule-parse'
import { buildScheduleDiff, scheduleFingerprint } from '@/lib/schedule-import'
import { archivedSeasons, fromArchive, fromLive, SCHEDULE_URL, type SourceKind } from '@/lib/schedule-source'
import { formatRaceDate } from '@/lib/races'
import { applySchedule, createSeason, existingRacesFor, setActiveSeason } from './actions'

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    season?: string
    source?: string
    error?: string
    added?: string
    changed?: string
    conflicts?: string
    created?: string
    activated?: string
  }>
}) {
  await requireAppUser('admin')
  const params = await searchParams
  const db = supabaseAdmin()

  const { data: seasonRows } = await db
    .from('seasons')
    .select('id, name, year, active, best_n, rules_verified')
    .order('year', { ascending: false })

  const seasons = seasonRows ?? []
  const activeSeason = seasons.find((s) => s.active)
  const folders = await archivedSeasons()

  // Default to the newest archived season, which is the one being worked on — not
  // the active one, which is usually last winter at the point somebody comes here.
  const season = params.season ?? folders[0] ?? (activeSeason?.name as string) ?? ''
  const sourceKind = (params.source as SourceKind) ?? 'archive'

  const seasonRow = seasons.find((s) => s.name === season)

  // --- load and parse, without writing anything ---
  let html: string | null = null
  let sourceLabel = ''
  let loadError: string | null = null

  try {
    if (sourceKind === 'live') {
      const live = await fromLive()
      html = live.html
      sourceLabel = live.description
    } else {
      const archived = season ? await fromArchive(season) : null
      if (archived) {
        html = archived.html
        sourceLabel = archived.description
      } else {
        loadError = `No archived schedule found for ${season || 'that season'}.`
      }
    }
  } catch (e) {
    loadError = (e as Error).message
  }

  const parsed = html ? parseSchedule(html, season) : null

  const existing = seasonRow ? await existingRacesFor(seasonRow.id as string) : []
  const diff = parsed
    ? buildScheduleDiff(parsed.races, existing, { season, warnings: parsed.warnings })
    : null

  // Has the page changed since it was last imported? Exact rather than time-based —
  // the schedule lives in the repository, so editing it is a commit.
  const { data: fingerprintRow } = await db
    .from('app_settings')
    .select('value')
    .eq('key', `schedule_import_${season}`)
    .maybeSingle()

  const lastFingerprint = (fingerprintRow?.value as string | null) ?? null
  const currentFingerprint = html ? scheduleFingerprint(html) : null
  const changedSinceImport =
    lastFingerprint !== null &&
    currentFingerprint !== null &&
    lastFingerprint !== currentFingerprint

  const applied =
    params.added !== undefined || params.changed !== undefined

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm">
        <Link href="/admin" className="text-neutral-600 underline">
          &larr; Admin
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">Race schedule</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Imported from the schedule the club publishes. Nothing is written until you
        press Apply, and nothing on file is ever deleted.
      </p>

      {params.error && (
        <p className="mt-4 rounded-lg border border-fwm-burgundy/40 bg-fwm-burgundy/5 p-3 text-sm text-fwm-burgundy" role="alert">
          {params.error}
        </p>
      )}

      {applied && (
        <p className="mt-4 rounded-lg border border-neutral-200 bg-surface p-3 text-sm dark:border-neutral-800">
          Applied: <strong>{params.added ?? 0}</strong> races added,{' '}
          <strong>{params.changed ?? 0}</strong> updated.
          {Number(params.conflicts ?? 0) > 0 && (
            <> {params.conflicts} left for you — they already have results.</>
          )}
        </p>
      )}

      {(params.created || params.activated) && (
        <p className="mt-4 rounded-lg border border-neutral-200 bg-surface p-3 text-sm dark:border-neutral-800">
          {params.created && <>Season {season} created. </>}
          {params.activated && <>{season} is now the active season.</>}
        </p>
      )}

      {/* --- season and source --- */}
      <section className="mt-8 rounded-lg border border-neutral-200 bg-surface p-5 dark:border-neutral-800">
        <form method="get" className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-sm font-medium">Season</span>
            <select
              name="season"
              defaultValue={season}
              className="mt-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            >
              {[...new Set([...folders, ...seasons.map((s) => s.name as string)])]
                .sort()
                .reverse()
                .map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Read from</span>
            <select
              name="source"
              defaultValue={sourceKind}
              className="mt-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            >
              <option value="archive">The copy in the repository</option>
              <option value="live">farwestmasters.org</option>
            </select>
          </label>

          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
          >
            Load
          </button>
        </form>

        {sourceLabel && (
          <p className="mt-3 text-sm text-neutral-600">
            Reading <code>{sourceLabel}</code>
            {sourceKind === 'live' && (
              <>
                {' '}&mdash;{' '}
                <a href={SCHEDULE_URL} className="underline" target="_blank" rel="noreferrer">
                  open the page
                </a>
              </>
            )}
          </p>
        )}

        {loadError && (
          <p className="mt-3 text-sm text-amber-800 dark:text-amber-300">{loadError}</p>
        )}

        {changedSinceImport && (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            This page has changed since it was last imported.
          </p>
        )}
      </section>

      {/* --- the season has to exist, and be active --- */}
      {season && !seasonRow && (
        <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40">
          <h2 className="font-medium text-amber-900 dark:text-amber-200">
            {season} does not exist yet
          </h2>
          <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
            Races belong to a season, so it has to be created first. It is created
            <strong> without scoring rules</strong> &mdash; best-N and the points scale
            are set separately, and nothing is scored until they are. A rule guessed
            from last season would produce standings that look right and are not.
          </p>
          <form action={createSeason} className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="season" value={season} />
            <label className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
              <input type="checkbox" name="make_active" defaultChecked />
              Make it the active season
            </label>
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
            >
              Create {season}
            </button>
          </form>
        </section>
      )}

      {seasonRow && !seasonRow.active && (
        <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40">
          <h2 className="font-medium text-amber-900 dark:text-amber-200">
            {season} is not the active season
          </h2>
          <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
            {activeSeason
              ? `${activeSeason.name} still is.`
              : 'No season is active.'}{' '}
            Everything that asks &ldquo;which season is it&rdquo; reads that flag,
            including the race picker in message templates &mdash; which shows nothing
            at all when the active season has no races left. That looks like a broken
            feature rather than a stale setting.
          </p>
          <form action={setActiveSeason} className="mt-3">
            <input type="hidden" name="season" value={season} />
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
            >
              Make {season} active
            </button>
          </form>
        </section>
      )}

      {seasonRow && Number(seasonRow.best_n) === 0 && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>{season} has no scoring rules yet.</strong> Races can be imported and
          texted about, but nothing will score correctly until best-N and the points
          scale are set. See RUNBOOK.md.
        </p>
      )}

      {/* --- the diff --- */}
      {diff && (
        <>
          {diff.empty ? (
            <p className="mt-6 rounded-lg border border-fwm-burgundy/40 bg-fwm-burgundy/5 p-4 text-sm text-fwm-burgundy">
              No races were found on that page. Nothing will be applied &mdash; an
              empty result is never treated as &ldquo;remove everything&rdquo;. Either
              the page has changed shape, or this is the wrong source.
            </p>
          ) : (
            <>
              <h2 className="mt-10 font-medium">
                {diff.toAdd.length} to add
                {diff.unchangedCount > 0 && (
                  <span className="ml-2 font-normal text-neutral-600">
                    · {diff.unchangedCount} already correct
                  </span>
                )}
              </h2>

              {diff.toAdd.length > 0 && (
                <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                  {diff.toAdd.map((r) => (
                    <li key={r.slug} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm">
                      <span className="font-mono text-neutral-600">
                        {formatRaceDate(r.date)}
                      </span>
                      <strong>{r.discipline}</strong>
                      <span>{r.venue}</span>
                      {r.series && <span className="text-neutral-600">{r.series}</span>}
                      {!r.countsTowardStandings && (
                        <span className="rounded bg-neutral-200 px-1.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          does not count
                        </span>
                      )}
                      {r.status === 'canceled' && (
                        <span className="text-fwm-burgundy">cancelled</span>
                      )}
                      <span className="text-neutral-600">
                        {r.runCount} {r.runCount === 1 ? 'run' : 'runs'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {diff.toChange.length > 0 && (
                <>
                  <h2 className="mt-8 font-medium">{diff.toChange.length} to update</h2>
                  <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
                    {diff.toChange.map((e) => (
                      <li key={e.existing.id} className="px-4 py-2 text-sm">
                        <span className="font-medium">{e.existing.name}</span>
                        <ul className="mt-1 text-neutral-600">
                          {e.changes.map((c) => (
                            <li key={c.field}>
                              {c.field}: {c.from} &rarr; {c.to}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* Held back, not applied. */}
              {diff.conflicts.length > 0 && (
                <>
                  <h2 className="mt-8 font-medium text-amber-800 dark:text-amber-300">
                    {diff.conflicts.length} left alone &mdash; they already have results
                  </h2>
                  <p className="mt-1 text-sm text-neutral-600">
                    Changing one of these would alter a published standing, which the
                    parity harness checks against every result since 2009. Change them
                    by hand if the page is right.
                  </p>
                  <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-amber-300 dark:divide-neutral-800 dark:border-amber-900">
                    {diff.conflicts.map((e) => (
                      <li key={e.existing.id} className="px-4 py-2 text-sm">
                        <span className="font-medium">{e.existing.name}</span>
                        <ul className="mt-1 text-neutral-600">
                          {e.changes.map((c) => (
                            <li key={c.field}>
                              {c.field}: {c.from} &rarr; {c.to}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {diff.onFileNotOnPage.length > 0 && (
                <>
                  <h2 className="mt-8 font-medium">
                    {diff.onFileNotOnPage.length} on file, not on the page
                  </h2>
                  <p className="mt-1 text-sm text-neutral-600">
                    <strong>Left alone.</strong> Results hang off races, and a page
                    dropping a row is not evidence a race did not happen. Usually one
                    added by hand, or one removed after it ran.
                  </p>
                  <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-dashed border-neutral-300 dark:divide-neutral-800 dark:border-neutral-700">
                    {diff.onFileNotOnPage.map((r) => (
                      <li key={r.id} className="px-4 py-2 text-sm text-neutral-600">
                        {formatRaceDate(r.date)} {r.discipline} {r.venue}
                        {r.hasResults && ' — has results'}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* Rows the parser would not guess at. */}
              {diff.warnings.length > 0 && (
                <>
                  <h2 className="mt-8 font-medium text-amber-800 dark:text-amber-300">
                    {diff.warnings.length} rows need a person
                  </h2>
                  <p className="mt-1 text-sm text-neutral-600">
                    The page does not say enough to place these races on a day.
                    Refusing costs you a manual entry; guessing wrong costs a season of
                    standings.
                  </p>
                  <ul className="mt-3 space-y-2">
                    {diff.warnings.map((w, i) => (
                      <li
                        key={`${w.sourceRow}-${i}`}
                        className="rounded-lg border border-amber-300 px-4 py-2 text-sm dark:border-amber-900"
                      >
                        <span className="font-mono">{w.date}</span>
                        <span className="mt-0.5 block text-neutral-600">{w.message}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {seasonRow && (
                <form action={applySchedule} className="mt-8">
                  <input type="hidden" name="season" value={season} />
                  <input type="hidden" name="source" value={sourceKind} />
                  <button
                    type="submit"
                    disabled={diff.toAdd.length === 0 && diff.toChange.length === 0}
                    className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
                  >
                    {diff.toAdd.length === 0 && diff.toChange.length === 0
                      ? 'Nothing to apply'
                      : `Apply — add ${diff.toAdd.length}, update ${diff.toChange.length}`}
                  </button>
                </form>
              )}
            </>
          )}
        </>
      )}
    </main>
  )
}

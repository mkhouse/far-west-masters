'use client'

/**
 * Upload a weekend's roster, say which column is which race, then decide.
 *
 * Built the same way as the membership importer, and deliberately so — the two
 * screens are the same job twice, and an officer who has learned one should not
 * have to learn the other. Same auto-preview on choosing a file, same way out
 * at both ends, same "here is what pressing the button will do" above it.
 *
 * The one thing it does that the membership importer does not: the races are
 * columns in the file, so the file is read first and the mapping asked for
 * second. Nothing can be imported until every column has a race, because the
 * roster's own header date is a registration deadline rather than a race date
 * and there is nothing in the file to infer the mapping from.
 */

import { useEffect, useState, useTransition } from 'react'
import {
  applyRoster,
  previewRoster,
  type RaceApplyResult,
  type RaceMapping,
  type RacePreview,
} from './actions'
import { countTempRacers, defaultWithdrawals, withdrawalKey } from '@/lib/race-roster'

export interface RaceOption {
  id: string
  name: string
  date: string
  discipline: string
  venue: string | null
  entryCount: number
}

export function EntriesForm({
  races,
  seasonName,
}: {
  races: RaceOption[]
  seasonName: string
}) {
  const [pending, startTransition] = useTransition()
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<RacePreview | null>(null)
  const [applied, setApplied] = useState<RaceApplyResult | null>(null)
  const [mapping, setMapping] = useState<RaceMapping>({})
  const [withdrawals, setWithdrawals] = useState<Set<string>>(new Set())
  const [resetKey, setResetKey] = useState(0)

  function cancel() {
    setCsv(null)
    setFileName(null)
    setPreview(null)
    setApplied(null)
    setMapping({})
    setWithdrawals(new Set())
    setResetKey((k) => k + 1)
  }

  function onFile(file: File | undefined) {
    setPreview(null)
    setApplied(null)
    setMapping({})
    setWithdrawals(new Set())
    if (!file) {
      setCsv(null)
      setFileName(null)
      return
    }
    setFileName(file.name)
    file.text().then(setCsv)
  }

  /**
   * Preview as soon as there is a file, and again whenever the mapping changes
   * — the mapping is what decides which existing entries the diff is against,
   * so a withdrawal cannot be known until a column has a race.
   *
   * Debounced and cancellable for the same reasons as the membership importer:
   * the requests are concurrent, and a slow early one must not land on top of a
   * fast later one.
   */
  useEffect(() => {
    if (!csv) return

    let cancelled = false
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await previewRoster(csv, mapping)
        if (cancelled) return
        setPreview(result)
        setWithdrawals(result.diffs ? defaultWithdrawals(result.diffs) : new Set())
      })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [csv, mapping])

  /**
   * Offer each column the races of its own discipline first, in date order.
   *
   * A suggestion, never applied on the officer's behalf: picking wrongly here
   * puts Sunday's field into Saturday's race, and there is nothing in the file
   * that would catch it afterwards.
   */
  function racesFor(discipline: string): RaceOption[] {
    const same = races.filter((r) => r.discipline === discipline)
    const rest = races.filter((r) => r.discipline !== discipline)
    return [...same, ...rest]
  }

  if (applied?.ok) {
    return (
      <div className="mt-6 rounded-lg border border-fwm-navy/40 bg-fwm-navy/5 p-4">
        <p className="font-medium">Imported</p>
        <p className="mt-1 text-sm">{applied.message}</p>
        <p className="mt-3 text-sm text-neutral-600">
          Those races can now be picked as an audience on the compose screen.
        </p>
        <button
          type="button"
          onClick={cancel}
          className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium dark:border-neutral-700"
        >
          Import another file
        </button>
      </div>
    )
  }

  const diffs = preview?.ok ? (preview.diffs ?? []) : []
  const unmapped = diffs.filter((d) => !mapping[d.column.header])
  const totalNew = diffs.reduce(
    (n, d) => (mapping[d.column.header] ? n + d.newEntries.length : n),
    0
  )
  // Deduplicated across races — see countTempRacers. Summing the per-race
  // figures said a 45-person file would create 47 people.
  const totalTemp = countTempRacers(diffs.filter((d) => mapping[d.column.header]))
  const totalWithdrawn = withdrawals.size

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
        <label className="block text-sm font-medium" htmlFor="roster">
          Race roster
        </label>
        <p className="mt-0.5 text-sm text-neutral-600">
          For {seasonName || 'the active season'}. The file is read as soon as
          you choose it.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            key={resetKey}
            id="roster"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block text-sm text-transparent file:mr-0 file:cursor-pointer file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-neutral-900 hover:file:bg-neutral-100 dark:file:border-neutral-700 dark:file:text-neutral-100 dark:hover:file:bg-neutral-900"
          />
          <span className="text-sm text-neutral-600">
            {fileName ?? 'No file chosen yet'}
          </span>
        </div>

        {fileName && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-neutral-600" role="status" aria-live="polite">
              {pending
                ? 'Reading the roster…'
                : `${preview?.rowsInFile ?? 0} people in the file.`}
            </span>
            <button
              type="button"
              onClick={cancel}
              className="text-neutral-600 underline"
            >
              Choose a different file
            </button>
          </div>
        )}
      </div>

      {preview && !preview.ok && (
        <p className="rounded-md border border-fwm-burgundy/40 bg-fwm-burgundy/5 px-3 py-2 text-sm text-fwm-burgundy">
          {preview.error}
        </p>
      )}

      {applied && !applied.ok && (
        <p className="rounded-md border border-fwm-burgundy/40 bg-fwm-burgundy/5 px-3 py-2 text-sm text-fwm-burgundy">
          {applied.error}
        </p>
      )}

      {diffs.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
          <h2 className="font-medium">
            {diffs.length === 1
              ? 'One race in this file'
              : `${diffs.length} races in this file`}
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Say which of your races each one is. The date in the file&rsquo;s own
            heading is a registration deadline, not the race day, so this cannot
            be worked out for you.
          </p>

          {diffs.map((d) => {
            const raceId = mapping[d.column.header]
            const race = races.find((r) => r.id === raceId)

            return (
              <section
                key={d.column.header}
                className="mt-4 rounded-md border border-neutral-200 px-3 py-3 text-sm dark:border-neutral-800"
              >
                <p className="font-medium">
                  {d.column.name}{' '}
                  <span className="font-normal text-neutral-600">
                    [{d.column.discipline}] &middot; {d.inFile}{' '}
                    {d.inFile === 1 ? 'entrant' : 'entrants'}
                  </span>
                </p>

                {/* The file states its own count in the header. It matched the
                    real cell count exactly on the first real roster, so a
                    disagreement means truncation or a parsing fault — both of
                    which otherwise look like a quiet weekend. */}
                {!d.countMatches && (
                  <p className="mt-1 text-fwm-burgundy">
                    The file&rsquo;s heading says {d.column.statedCount} but{' '}
                    {d.inFile} {d.inFile === 1 ? 'row has' : 'rows have'} a
                    registration time. Do not import this — the download looks
                    incomplete.
                  </p>
                )}

                <label className="mt-2 block">
                  <span className="text-neutral-600">This is</span>
                  <select
                    value={raceId ?? ''}
                    onChange={(e) =>
                      setMapping((prev) => ({
                        ...prev,
                        [d.column.header]: e.target.value,
                      }))
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
                  >
                    <option value="">— pick a race —</option>
                    {racesFor(d.column.discipline).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.date} · {r.name}
                        {r.entryCount > 0 ? ` (${r.entryCount} entered)` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                {race && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                    <Stat label="Would be added" value={d.newEntries.length} />
                    <Stat label="Already entered" value={d.alreadyEntered} />
                    <Stat label="Withdrawn" value={d.withdrawn.length} />
                    <Stat label="Temp racers" value={d.tempRacers.length} />
                  </dl>
                )}

                {race && d.tempRacers.length > 0 && (
                  <div className="mt-3">
                    <p className="font-medium">
                      {d.tempRacers.length} not in the club — these will be
                      created as temp racers
                    </p>
                    {/* Listed in full and never summarised. Temp racers and
                        skiers from other divisions genuinely enter Far West
                        races, so this is ordinary — but a duplicate spelling of
                        somebody we already hold shows up here too, and that is
                        worth catching before it becomes a second record for one
                        human. */}
                    <ul className="mt-1 space-y-0.5 text-neutral-600">
                      {d.tempRacers.map((e, i) => (
                        <li key={i}>
                          {e.racer.firstName} {e.racer.lastName}
                          {e.racer.usssa ? ` · USSA ${e.racer.usssa}` : ' · no USSA number'}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-neutral-600">
                      They cannot be texted — nothing here opts anybody in. This
                      is so the entry list is complete.
                    </p>
                  </div>
                )}

                {race && d.withdrawn.length > 0 && (
                  <div className="mt-3 rounded-r-md border-l-[3px] border-fwm-amber bg-fwm-amber/10 px-3 py-2">
                    <p className="font-medium text-fwm-amber-text">
                      {d.withdrawn.length}{' '}
                      {d.withdrawn.length === 1 ? 'person is' : 'people are'}{' '}
                      entered here and no longer in the file
                    </p>
                    <p className="mt-1 text-neutral-700 dark:text-neutral-300">
                      Ticked to remove, because AdminSkiRacing is saying they are
                      not in this race. Leaving one means a message to
                      &ldquo;everyone racing&rdquo; reaches somebody who pulled
                      out.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {d.withdrawn.map((w) => {
                        const key = withdrawalKey(d.column.header, w.personId)
                        return (
                          <li key={key}>
                            <label className="flex cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={withdrawals.has(key)}
                                onChange={() =>
                                  setWithdrawals((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(key)) next.delete(key)
                                    else next.add(key)
                                    return next
                                  })
                                }
                              />
                              <span>
                                {w.name}
                                <span className="text-neutral-600">
                                  {w.stillInFile
                                    ? ' · in the file, not in this race'
                                    : ' · gone from the file altogether'}
                                </span>
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </section>
            )
          })}

          {/* What the button will do, next to the button, counting across every
              mapped race. */}
          <p className="mt-4 text-sm text-neutral-600">
            {unmapped.length > 0 ? (
              <>
                <strong className="text-foreground">
                  {unmapped.length} {unmapped.length === 1 ? 'race' : 'races'}{' '}
                  still {unmapped.length === 1 ? 'needs' : 'need'} picking.
                </strong>{' '}
                Nothing will be imported until every column has a race.
              </>
            ) : (
              <>
                <strong className="text-foreground">
                  {totalNew} {totalNew === 1 ? 'entry' : 'entries'} would be
                  recorded
                </strong>
                {totalTemp > 0
                  ? `, ${totalTemp} temp ${totalTemp === 1 ? 'racer' : 'racers'} created`
                  : ''}
                {totalWithdrawn > 0
                  ? `, and ${totalWithdrawn} ${totalWithdrawn === 1 ? 'withdrawal' : 'withdrawals'} removed`
                  : ''}
                .
              </>
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending || unmapped.length > 0}
              onClick={() =>
                startTransition(async () =>
                  setApplied(await applyRoster(csv!, mapping, [...withdrawals]))
                )
              }
              className="rounded-md border border-fwm-navy/40 bg-fwm-navy/5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              {pending ? 'Importing…' : 'Import these entries'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={cancel}
              className="text-sm text-neutral-600 underline disabled:opacity-40"
            >
              Cancel this import
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-sm text-neutral-600">{label}</dt>
      <dd className="text-lg font-medium">{value}</dd>
    </div>
  )
}

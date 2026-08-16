'use client'

/**
 * Upload an export, see what it would do, then decide.
 *
 * The preview is not a formality. On a first import this writes 161 memberships and
 * creates seven people; on a later one it should change almost nothing, and "almost
 * nothing" is the thing worth checking. If a repeat import suddenly wants to change
 * ninety records, something is wrong with the file, not with the club.
 *
 * The file is read in the browser and its text passed to the server twice — once to
 * preview, once to apply. Apply re-parses it rather than trusting the diff it showed,
 * so what lands is what the file says.
 */

import { useState, useTransition } from 'react'
import {
  applyImport,
  previewImport,
  type ApplyResult,
  type PreviewResult,
} from './actions'
import {
  changeCount,
  differenceKey,
  entriesWithChanges,
  entriesWithDifferences,
} from '@/lib/membership-import'

export function ImportForm({ suggestedSeason }: { suggestedSeason: string }) {
  const [pending, startTransition] = useTransition()
  const [season, setSeason] = useState(suggestedSeason)
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [applied, setApplied] = useState<ApplyResult | null>(null)
  /**
   * Which reported differences to accept, as personId:field.
   *
   * Empty to start: not overwriting is the safe default, because what we hold is
   * often the member's own answer from the opt-in form. But many of these are a work
   * address being replaced by a personal one, which is exactly the case where ASR is
   * fresher — so the choice is per row rather than a rule.
   */
  const [accepted, setAccepted] = useState<Set<string>>(new Set())

  function onFile(file: File | undefined) {
    setPreview(null)
    setApplied(null)
    setAccepted(new Set())
    if (!file) {
      setCsv(null)
      setFileName(null)
      return
    }
    setFileName(file.name)
    file.text().then(setCsv)
  }

  if (applied?.ok) {
    return (
      <div className="mt-6 rounded-lg border border-fwm-navy/40 bg-fwm-navy/5 p-4">
        <p className="font-medium">Imported</p>
        <p className="mt-1 text-sm">{applied.message}</p>
        <p className="mt-3 text-sm text-neutral-600">
          The members directory now reflects this. Reload it to see the change.
        </p>
      </div>
    )
  }

  const diff = preview?.diff

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
        <label className="block text-sm font-medium" htmlFor="season">
          Season
        </label>
        <p className="mt-0.5 text-sm text-neutral-600">
          Not in the file — AdminSkiRacing only records an event id — so it is typed
          once per import.
        </p>
        <input
          id="season"
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          className="mt-2 w-48 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="file">
          Membership export
        </label>
        <p className="mt-0.5 text-sm text-neutral-600">
          The Event Roster CSV from AdminSkiRacing. Every download holds the whole
          list, so importing the same file twice changes nothing.
        </p>
        {/* The browser's own control reads "Choose File / no file selected", which
            is neither the club's language nor legible. The input itself is kept —
            it is the accessible, keyboard-operable thing — and only its button is
            restyled, with the chosen file named beside it. */}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            id="file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block text-sm text-transparent file:mr-0 file:cursor-pointer file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-neutral-900 hover:file:bg-neutral-100 dark:file:border-neutral-700 dark:file:text-neutral-100 dark:hover:file:bg-neutral-900"
          />
          <span className="text-sm text-neutral-600">
            {fileName ?? 'No file chosen yet'}
          </span>
        </div>

        <button
          type="button"
          disabled={!csv || pending}
          onClick={() =>
            startTransition(async () => setPreview(await previewImport(csv!, season)))
          }
          className="mt-4 rounded-md border border-fwm-navy/40 bg-fwm-navy/5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {pending && !preview ? 'Reading…' : 'See what this would change'}
        </button>
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

      {diff && (
        <div className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
          <h2 className="font-medium">
            What {fileName} would do to {season}
          </h2>
          {preview?.repeatImport && (
            <p className="mt-1 text-sm text-neutral-600">
              This season has been imported before, so what follows is only what has
              changed since.
            </p>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Stat label="Rows in file" value={diff.rowsInFile} />
            <Stat label="Memberships added" value={diff.joined.length + diff.unmatched.length} />
            <Stat label="Gaps filled" value={changeCount(diff)} />
            <Stat label="Unchanged" value={diff.unchanged} />
          </dl>

          {/* People being created. Listed in full and never summarised: these are new
              rows in the member database, and seeing the names is how a duplicate
              spelling gets caught before it becomes a second record for one human. */}
          {diff.unmatched.length > 0 && (
            <Section title={`${diff.unmatched.length} people not in the club yet — these will be created`}>
              <ul className="mt-1 space-y-0.5">
                {diff.unmatched.map((u, i) => (
                  <li key={i}>
                    {u.member.firstName} {u.member.lastName}
                    <span className="text-neutral-600">
                      {' '}· {u.member.email || 'no email'}
                      {u.member.usssa ? ` · USSA ${u.member.usssa}` : ' · no USSA number'}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Across joined AND updated. On a first import everybody is joining, and
              their corrections still need showing. */}
          {entriesWithChanges(diff).length > 0 && (
            <Section
              title={`${changeCount(diff)} missing detail(s) would be filled in, on ${entriesWithChanges(diff).length} people`}
            >
              <ul className="mt-1 space-y-0.5">
                {entriesWithChanges(diff).map((u, i) => (
                  <li key={i}>
                    {u.member.firstName} {u.member.lastName}
                    {u.changes.map((c) => (
                      <span key={c.field} className="text-neutral-600">
                        {' '}· {c.field}: {c.from ?? '—'} → {c.to}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Not applied unless ticked. Which value is right is a judgement the
              system genuinely cannot make: what we hold is often the member's own
              answer from the opt-in form, and what ASR holds is often a personal
              address replacing a work one. So it asks. */}
          {entriesWithDifferences(diff).length > 0 && (
            <Section
              title={`${entriesWithDifferences(diff).length} people where AdminSkiRacing holds something different`}
            >
              <p className="mt-1 text-neutral-600">
                Nothing here is changed unless you tick it, and whether the member
                opted in is usually what decides.
              </p>
              <p className="mt-1 text-neutral-600">
                <strong>Opted in</strong> — the address we hold is the one they gave
                on the opt-in form, so ours is their own answer.{' '}
                <strong>Never opted in</strong> — ours came from a historic import
                rather than from them, and AdminSkiRacing&rsquo;s is usually fresher,
                often a personal address replacing a work one.
              </p>

              <div className="mt-2 flex gap-3 text-sm">
                <button
                  type="button"
                  className="text-fwm-navy underline"
                  onClick={() =>
                    setAccepted(
                      new Set(
                        entriesWithDifferences(diff).flatMap((e) =>
                          e.differences.map((d) => differenceKey(e.personId!, d.field))
                        )
                      )
                    )
                  }
                >
                  Take all of AdminSkiRacing&rsquo;s
                </button>
                {/* The rule stated as one click. Still every row on screen, still
                    every tick reversible — this only saves the clicks. */}
                <button
                  type="button"
                  className="text-fwm-navy underline"
                  onClick={() =>
                    setAccepted(
                      new Set(
                        entriesWithDifferences(diff)
                          .filter((e) => !e.optedIn)
                          .flatMap((e) =>
                            e.differences.map((d) => differenceKey(e.personId!, d.field))
                          )
                      )
                    )
                  }
                >
                  Take theirs only where the member never opted in
                </button>
                <button
                  type="button"
                  className="text-neutral-600 underline"
                  onClick={() => setAccepted(new Set())}
                >
                  Keep all of ours
                </button>
              </div>

              <ul className="mt-2 space-y-1">
                {[...entriesWithDifferences(diff)]
                  .sort((a, b) => Number(a.optedIn) - Number(b.optedIn))
                  .map((u) =>
                  u.differences.map((c) => {
                    const key = differenceKey(u.personId!, c.field)
                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={accepted.has(key)}
                            onChange={() =>
                              setAccepted((prev) => {
                                const next = new Set(prev)
                                if (next.has(key)) next.delete(key)
                                else next.add(key)
                                return next
                              })
                            }
                          />
                          <span>
                            {u.member.firstName} {u.member.lastName}
                            {/* The deciding fact, next to the decision. */}
                            <span
                              className={`ml-2 rounded-full px-1.5 py-0.5 text-xs ${
                                u.optedIn
                                  ? 'bg-fwm-navy/10 text-fwm-navy'
                                  : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                              }`}
                            >
                              {u.optedIn ? 'opted in' : 'never opted in'}
                            </span>
                            <span className="text-neutral-600">
                              {' '}· {c.field}: <s>{c.from ?? '—'}</s> &rarr;{' '}
                              <strong>{c.to}</strong>
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })
                )}
              </ul>
            </Section>
          )}

          {/* Flagged, never acted on. The export is cumulative, so a disappearance
              means a refund or a correction made in ASR — a decision for a person. */}
          {diff.missing.length > 0 && (
            <Section
              title={`${diff.missing.length} held for ${season} but absent from this file`}
              tone="warn"
            >
              <p className="mt-1 text-neutral-600">
                Left exactly as they are. A cumulative export missing somebody usually
                means a refund or a correction in AdminSkiRacing, which is not
                something this import should decide.
              </p>
              <ul className="mt-1 space-y-0.5">
                {diff.missing.map((m) => (
                  <li key={m.personId}>{m.name}</li>
                ))}
              </ul>
            </Section>
          )}

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () =>
              setApplied(await applyImport(csv!, season, [...accepted]))
            )
            }
            className="mt-4 rounded-md border border-fwm-navy/40 bg-fwm-navy/5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            {pending
              ? 'Importing…'
              : accepted.size > 0
                ? `Import ${season}, taking ${accepted.size} correction${accepted.size === 1 ? '' : 's'}`
                : `Import ${season}`}
          </button>
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

function Section({
  title,
  tone = 'plain',
  children,
}: {
  title: string
  tone?: 'plain' | 'warn'
  children: React.ReactNode
}) {
  return (
    <section
      className={`mt-4 rounded-md border px-3 py-2 text-sm ${
        tone === 'warn'
          ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
          : 'border-neutral-200 dark:border-neutral-800'
      }`}
    >
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  )
}

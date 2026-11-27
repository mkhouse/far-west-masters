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

import { useEffect, useState, useTransition } from 'react'
import {
  applyImport,
  previewImport,
  type ApplyResult,
  type PreviewResult,
} from './actions'
import {
  changeCount,
  defaultAccepted,
  differenceCount,
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
   * Seeded from `defaultAccepted` on every preview — the club's rule, applied —
   * and then whatever the officer changes. Not empty to start: see that function
   * for why a blank slate was the wrong default.
   */
  const [accepted, setAccepted] = useState<Set<string>>(new Set())
  /**
   * Bumped to remount the file input. See `cancel` — clearing React state is not
   * enough, because the input holds its own copy of the chosen file.
   */
  const [resetKey, setResetKey] = useState(0)

  /**
   * Work out what the file would do, as soon as there is a file.
   *
   * THIS USED TO BE A BUTTON. "See what this would change" asked a question the
   * officer had already answered by choosing the file, and the preview writes
   * nothing — so there was nothing to consent to. Picking the wrong export (Race
   * File, not Race Roster) now shows its refusal straight away rather than after
   * a click you had to know to make.
   *
   * Keyed on the season as well as the file, which the button never handled: it
   * previewed against whatever the season box said at the moment you pressed it,
   * and editing the box afterwards left the preview quietly stale.
   *
   * Debounced because the season is a free-text box — without it, typing
   * "2026-2027" is nine server round-trips. The cancelled flag matters more: the
   * requests are concurrent, and a slow early one must not land on top of a fast
   * later one and leave the screen describing a season nobody asked about.
   */
  useEffect(() => {
    if (!csv) return

    let cancelled = false
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await previewImport(csv, season)
        if (cancelled) return
        setPreview(result)
        setAccepted(result.diff ? defaultAccepted(result.diff) : new Set())
      })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [csv, season])

  /**
   * Back to the empty form.
   *
   * THERE WAS NO WAY OUT. Once a file was chosen the only exit was reloading the
   * page — on a screen whose whole purpose is deciding whether to go ahead, and
   * where the wrong file (Race File, not Race Roster) is a routine mistake. The
   * key bump matters: the file input keeps its own copy of the selection, so
   * clearing state alone left the browser still naming a file that was gone.
   */
  function cancel() {
    setCsv(null)
    setFileName(null)
    setPreview(null)
    setApplied(null)
    setAccepted(new Set())
    setResetKey((k) => k + 1)
  }

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
        {/* Also a dead end until now. Importing two files in a row is ordinary —
            a season and a camp, or the same season re-exported after a fix. */}
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
          The <strong>Race Roster</strong> download from AdminSkiRacing. It saves as{' '}
          <code>EventRoster….csv</code> — the button and the filename disagree, and
          both names are right. Every download holds the whole list, so importing the
          same file twice changes nothing.
        </p>
        {/* THE ADJACENT BUTTON IS THE WRONG ONE. “Race File” sits beside “Race
            Roster” on the same row in ASR and produces a file that looks correct:
            same rows, same members, same event id. It has no Cell Phone or Email
            column, so the import refuses it — see REQUIRED_COLUMNS. Naming it here
            costs a line and saves a download, an upload and a rejection. */}
        <p className="mt-1 text-sm text-neutral-600">
          Not <strong>Race File</strong>, the button beside it: that export carries no
          phone numbers or email addresses, and will be refused.
        </p>
        {/* The browser's own control reads "Choose File / no file selected", which
            is neither the club's language nor legible. The input itself is kept —
            it is the accessible, keyboard-operable thing — and only its button is
            restyled, with the chosen file named beside it. */}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            key={resetKey}
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

        {/* What used to be the "See what this would change" button. The preview
            now runs on its own (see the effect above), so what is left here is
            the state of that work and the way back out.

            Two ways out, because the screen is long: this one is where somebody
            realises they picked the wrong export, and the one by the Import
            button is where they decide not to go ahead. Same `cancel`. */}
        {/* Keyed on the NAME, not the parsed text. `file.text()` resolves a tick
            after the pick, so between the two `csv` is still null while a file
            is plainly chosen — and this row would blink out of existence in the
            gap. */}
        {fileName && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span
              className="text-neutral-600"
              role="status"
              aria-live="polite"
            >
              {pending
                ? 'Working out what this would change…'
                : 'Below: what this file would do.'}
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
              title={`${differenceCount(diff)} differences — choose which to take from AdminSkiRacing`}
            >
              {/* THE RULE, APPLIED — NOT A BLANK SLATE AND THREE SHORTCUTS.
                  This screen used to start with nothing ticked and ask the
                  officer to build their rule out of three links, every import.
                  The rule does not change between imports, so the software now
                  knows it. See defaultAccepted.

                  What was here before — a legend drawn out of disabled
                  checkboxes sitting one line above the real ones — was worse
                  than nothing: two rows of things that looked clickable, one of
                  which was a decoy, directly above a column of things that were.
                  The ticks explain themselves once they are visible in the rows;
                  this says why they are where they are. */}
              <p className="mt-1 text-neutral-600">
                <strong className="text-foreground">
                  Already ticked, by the club&rsquo;s rule.
                </strong>{' '}
                We keep whatever a human has chosen — what the member typed into
                the opt-in form, and anything corrected here since the last
                import. AdminSkiRacing&rsquo;s is taken only where neither has
                happened. Change any row you disagree with.
              </p>

              {/* Two escape hatches, not three choices. The third used to be
                  "only those who never opted in", which is the default now. */}
              <p className="mt-2 text-sm text-neutral-600">
                Or{' '}
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
                  take all {differenceCount(diff)}
                </button>{' '}
                &middot;{' '}
                <button
                  type="button"
                  className="text-fwm-navy underline"
                  onClick={() => setAccepted(new Set())}
                >
                  keep all of ours
                </button>
              </p>

              <ul className="mt-2 space-y-1">
                {[...entriesWithDifferences(diff)]
                  .sort((a, b) => Number(a.optedIn) - Number(b.optedIn))
                  .map((u) =>
                  u.differences.map((c) => {
                    const key = differenceKey(u.personId!, c.field)
                    const ticked = accepted.has(key)
                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={ticked}
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
                            {/* WHY THIS ROW IS NOT TICKED WHEN IT LOOKS LIKE IT
                                SHOULD BE. "Never opted in" normally means take
                                theirs — so a never-opted-in row sitting unticked
                                reads as a bug unless it says what stopped it.
                                Three members are in this state today, all of
                                them a work address somebody replaced with a
                                personal one. */}
                            {c.oursEdited && !u.optedIn && c.field !== 'usssa' ? (
                              /* Teal, not amber. Amber means something is
                                 waiting for you; this is the opposite — a value
                                 a human has already settled, which is why the
                                 import is leaving it alone. Nothing is owed. */
                              <span className="ml-1.5 rounded-full bg-fwm-teal/15 px-1.5 py-0.5 text-xs text-fwm-teal-text">
                                corrected here
                              </span>
                            ) : null}
                            {/* THE ROW SHOWS ITS OWN STATE. Every row used to
                                render `struck-out → bold` whether ticked or not
                                — the same notation the "gaps filled" box above
                                uses for changes that WILL be applied. The box
                                was drawing a completed change and then denying
                                it in prose, and prose loses that argument. The
                                strikethrough now appears only once the tick
                                makes it true. */}
                            {ticked ? (
                              <span className="text-neutral-600">
                                {' '}· {c.field}: <s>{c.from ?? '—'}</s> &rarr;{' '}
                                <strong>{c.to}</strong>
                              </span>
                            ) : (
                              /* BOTH SIDES NAMED. This read "email: VALUE ·
                                 AdminSkiRacing has VALUE" — which labels one of
                                 the two and leaves the other to be worked out
                                 from word order. Parallel labels mean the row
                                 does not depend on having read anything above
                                 it. */
                              <span className="text-neutral-600">
                                {' '}· {c.field} · club:{' '}
                                <strong>{c.from ?? '—'}</strong> · AdminSkiRacing:{' '}
                                {c.to}
                              </span>
                            )}
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

          {entriesWithDifferences(diff).length > 0 && (
            <WhatWillHappen total={differenceCount(diff)} ticked={accepted.size} />
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () =>
                  setApplied(await applyImport(csv!, season, [...accepted]))
                )
              }
              className="rounded-md border border-fwm-navy/40 bg-fwm-navy/5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              {pending
                ? 'Importing…'
                : accepted.size > 0
                  ? `Import ${season}, taking ${accepted.size} correction${accepted.size === 1 ? '' : 's'}`
                  : `Import ${season}`}
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

/**
 * What pressing Import will actually do, in a sentence that changes as you tick.
 *
 * Every control on the screen can be labelled correctly and somebody can still be
 * unsure which state they have put it in: six rows, three bulk links, and a scroll
 * between the last tick and the button. This is the running total, sitting next to
 * that button, so "what happens if I press this" is answered where it is asked.
 */
function WhatWillHappen({ total, ticked }: { total: number; ticked: number }) {
  if (ticked === 0) {
    return (
      <p className="mt-4 text-sm text-neutral-600">
        <strong className="text-foreground">Nothing ticked.</strong> All {total}{' '}
        {total === 1 ? 'disagreement' : 'disagreements'} above stay exactly as the
        club has {total === 1 ? 'it' : 'them'}.
      </p>
    )
  }

  const keeping = total - ticked
  return (
    <p className="mt-4 text-sm text-neutral-600">
      <strong className="text-foreground">
        {ticked} of {total} ticked.
      </strong>{' '}
      {ticked === 1 ? 'That one' : `Those ${ticked}`} will be replaced by
      AdminSkiRacing&rsquo;s
      {keeping === 0
        ? ''
        : keeping === 1
          ? ', and the other one stays as it is'
          : `, and the other ${keeping} stay as they are`}
      .
    </p>
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
      className={`mt-4 px-3 py-2 text-sm ${
        tone === 'warn'
          ? 'rounded-r-md border-l-[3px] border-fwm-amber bg-fwm-amber/10'
          : 'rounded-md border border-neutral-200 dark:border-neutral-800'
      }`}
    >
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  )
}

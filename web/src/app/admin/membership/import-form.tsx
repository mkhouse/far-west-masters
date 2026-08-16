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

export function ImportForm({ suggestedSeason }: { suggestedSeason: string }) {
  const [pending, startTransition] = useTransition()
  const [season, setSeason] = useState(suggestedSeason)
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [applied, setApplied] = useState<ApplyResult | null>(null)

  function onFile(file: File | undefined) {
    setPreview(null)
    setApplied(null)
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
        <input
          id="file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="mt-2 block w-full text-sm"
        />

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
            <Stat label="Details updated" value={diff.updated.length} />
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

          {diff.updated.length > 0 && (
            <Section title={`${diff.updated.length} contact details would change`}>
              <ul className="mt-1 space-y-0.5">
                {diff.updated.map((u, i) => (
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
              startTransition(async () => setApplied(await applyImport(csv!, season)))
            }
            className="mt-4 rounded-md border border-fwm-navy/40 bg-fwm-navy/5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            {pending ? 'Importing…' : `Import ${season}`}
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

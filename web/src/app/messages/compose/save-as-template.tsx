'use client'

/**
 * Keep the message you just wrote.
 *
 * The moment an officer knows a message is worth reusing is the moment they finish
 * writing it, not later in an admin screen they would have to remember to visit. This
 * is that moment.
 *
 * THE WHOLE DIFFICULTY IS THE ABSTRACTION. By now the body reads "Hello Damian, this
 * is Mary from FWM membership, call me at (530) 555-1234". Saved as written, that
 * template greets every future member as Damian and hands Mary's mobile to all of
 * them — the exact failure the placeholders exist to prevent, arriving through the
 * most helpful-looking button on the screen.
 *
 * So the blanks are put back first, and **the result is shown before it is saved**.
 * Not a promise that it was handled: the actual text, to read. If the abstraction
 * missed something, it is visible right there rather than discovered by a member six
 * weeks later.
 */

import { useMemo, useState, useTransition } from 'react'
import { saveAsTemplate } from '@/app/admin/templates/actions'
import { formatPhone } from '@/lib/format'
import { TEMPLATE_CATEGORIES, unfillTemplate } from '@/lib/templates'

export function SaveAsTemplate({
  body,
  purpose,
  officerName,
  officerPhone,
  memberFirstName,
}: {
  body: string
  /** Seeds the name — it is already a short label for this message. */
  purpose: string
  officerName: string | null
  officerPhone: string | null
  memberFirstName: string | null
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>('new_member')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, startSaving] = useTransition()

  // What will actually be stored: the message with everything this screen knows
  // about turned back into a blank.
  const abstracted = useMemo(
    () =>
      unfillTemplate(body, {
        'first name': memberFirstName,
        'officer name': officerName,
        'officer phone': officerPhone ? formatPhone(officerPhone) : null,
      }),
    [body, memberFirstName, officerName, officerPhone]
  )

  const changed = abstracted !== body

  function save() {
    setError(null)
    startSaving(async () => {
      const result = await saveAsTemplate({
        name,
        category,
        body: abstracted,
        officerPhone,
      })
      if (result.ok) {
        setSaved(true)
        setOpen(false)
      } else {
        setError(result.error)
      }
    })
  }

  if (!body.trim()) return null

  if (saved) {
    return (
      <p className="mt-3 text-sm text-neutral-600">
        Saved as a template. It is in the &ldquo;Start from a template&rdquo; list for
        every officer.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setName(purpose.trim())
        }}
        className="mt-3 text-sm text-fwm-navy underline"
      >
        Save this message as a template
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">Save as a template</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-neutral-600 underline"
        >
          Cancel
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bib pickup"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>

        <label className="block">
          <span className="text-sm">Kind</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Shown, not promised. */}
      <p className="mt-3 text-sm font-medium">What will be saved</p>
      {changed && (
        <p className="mt-0.5 text-sm text-neutral-600">
          The name and number in your message have been turned back into blanks, so
          this fills in for whoever uses it. Templates are shared &mdash; saved as
          written, this one would hand out your number.
        </p>
      )}
      <p className="mt-2 whitespace-pre-wrap rounded-md border border-neutral-200 bg-surface p-3 font-mono text-sm dark:border-neutral-800 dark:bg-neutral-950">
        {abstracted}
      </p>

      {error && (
        <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving || !name.trim()}
        className="mt-3 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        {saving ? 'Saving…' : 'Save template'}
      </button>
    </div>
  )
}

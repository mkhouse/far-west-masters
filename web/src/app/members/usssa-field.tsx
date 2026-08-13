'use client'

/**
 * Fill in a missing USSA number, in place.
 *
 * Eighteen members are missing one, and without it they cannot race. Making that
 * fixable where you notice it — rather than on another screen, one page load per
 * person — is the difference between a list that gets worked through and one that
 * stays as it is.
 *
 * A number that is already set is shown, not offered for editing. Changing one can
 * silently detach a racer from their own results, and unlike a blank, a wrong
 * number looks right. That edit belongs in member admin, where it can be recorded.
 * The server refuses it too — this is not only a hidden button.
 *
 * A missing number shows as "Missing" in burgundy rather than an empty space,
 * because a blank cell reads as "nothing to see" when it is the opposite.
 */

import { useState, useTransition } from 'react'
import { setUsssa } from './actions'

export function UsssaField({
  personId,
  value,
}: {
  personId: string
  value: number | null
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Already set: display only.
  if (value !== null) return <span className="tabular-nums">{value}</span>

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await setUsssa(personId, draft)
      if (result.ok) setEditing(false)
      else setError(result.error ?? 'Could not save that.')
    })
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft('')
          setEditing(true)
        }}
        title="Add a USSA number"
        className="font-medium text-fwm-burgundy underline decoration-dotted underline-offset-4"
      >
        Missing
      </button>
    )
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          inputMode="numeric"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter saves, Escape abandons. Anyone working through a list of
            // eighteen will keep their hands on the keyboard.
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') {
              setEditing(false)
              setError(null)
            }
          }}
          className="w-28 rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm tabular-nums dark:border-neutral-700"
          placeholder="USSA number"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-neutral-700"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false)
            setError(null)
          }}
          className="px-1 text-sm text-neutral-600 underline"
        >
          Cancel
        </button>
      </span>

      {/* Errors sit under the field rather than in an alert: the likely one names
          another member, and you need to read it next to what you just typed. */}
      {error && (
        <span className="max-w-xs text-sm text-fwm-burgundy">{error}</span>
      )}
    </span>
  )
}

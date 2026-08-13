'use client'

/**
 * Add people to a group.
 *
 * A plain `<select>` of 293 names is fine for a two-person test group and
 * unusable for anything real: you cannot type a name, and you can only add one
 * person per round trip. Building a board group that way is a dozen page loads.
 *
 * So: filter as you type, tick several, add them in one submit. The whole candidate
 * list already arrives with the page, so filtering is over an array in memory —
 * no requests while typing.
 */

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { addMembers } from './actions'

export interface Candidate {
  id: string
  first_name: string
  last_name: string
  status: string
}

/** How many to show before asking for a narrower search. */
const VISIBLE_LIMIT = 40

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={count === 0 || pending}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-neutral-700"
    >
      {pending
        ? 'Adding…'
        : count === 0
          ? 'Add'
          : `Add ${count} ${count === 1 ? 'person' : 'people'}`}
    </button>
  )
}

export function MemberPicker({
  groupId,
  candidates,
}: {
  groupId: string
  candidates: Candidate[]
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const needle = filter.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!needle) return candidates
    return candidates.filter((c) =>
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(needle)
    )
  }, [candidates, needle])

  // Selected people stay visible even when the filter no longer matches them.
  // Otherwise ticking someone, then searching for the next person, appears to
  // discard the first — and the count says otherwise, which is worse.
  const shown = useMemo(() => {
    const visible = matches.slice(0, VISIBLE_LIMIT)
    const missing = candidates.filter(
      (c) => selected.has(c.id) && !visible.some((v) => v.id === c.id)
    )
    return [...missing, ...visible]
  }, [matches, candidates, selected])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (candidates.length === 0) {
    return (
      <p className="mt-3 text-sm text-neutral-600">
        Everyone with a phone number is already in this group.
      </p>
    )
  }

  return (
    <form action={addMembers} className="mt-3">
      <input type="hidden" name="group_id" value={groupId} />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="person_id" value={id} />
      ))}

      <div className="flex gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Search ${candidates.length} people…`}
          className="flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
        />
        <SubmitButton count={selected.size} />
      </div>

      {(needle || selected.size > 0) && (
        <ul className="mt-2 max-h-56 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          {shown.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span>
                  {c.first_name} {c.last_name}
                  <span className="ml-2 text-sm text-neutral-600">{c.status}</span>
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-3 py-2 text-sm text-neutral-600">
              Nobody matches “{filter}”.
            </li>
          )}
        </ul>
      )}

      {/* Say when the list is cut short. A silently truncated list is how someone
          concludes a member is not in the system. */}
      {matches.length > VISIBLE_LIMIT && (
        <p className="mt-1 text-sm text-neutral-600">
          Showing {VISIBLE_LIMIT} of {matches.length} matches — keep typing to narrow.
        </p>
      )}
    </form>
  )
}

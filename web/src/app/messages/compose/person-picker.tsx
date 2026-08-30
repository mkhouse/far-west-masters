'use client'

/**
 * Choose one member to message.
 *
 * Filter-as-you-type over a list already on the page, the same approach as the group
 * member picker — a plain `<select>` of 293 names cannot be typed into.
 *
 * TWO DELIBERATE CHOICES, both about what gets shown rather than what gets sent:
 *
 * 1. **Everybody is listed, not only people who can be texted.** Somebody who has not
 *    opted in still appears, with the reason. The alternative — quietly omitting them
 *    — turns "why is Bob not in this list?" into a mystery with no way to answer it
 *    from the screen you are on. This matches the members directory, which exists to
 *    answer exactly that question.
 *
 * 2. **Selecting an unreachable person is allowed, and then the send is refused.** The
 *    server re-resolves the audience and applies the consent gate regardless, so this
 *    cannot send anything; what it does is show the reason on the person you asked
 *    about. Preventing the selection would hide the explanation.
 */

import { useMemo, useState } from 'react'

export interface PersonOption {
  id: string
  firstName: string
  lastName: string
  /** Null when they can be texted; otherwise why not, in the directory's words. */
  blockedReason: string | null
}

/** How many to show before asking for a narrower search. */
const VISIBLE_LIMIT = 30

export function PersonPicker({
  people,
  selectedId,
  onSelect,
}: {
  people: PersonOption[]
  selectedId: string
  onSelect: (person: PersonOption | null) => void
}) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people
      .filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q))
      .slice(0, VISIBLE_LIMIT)
  }, [people, query])

  const selected = people.find((p) => p.id === selectedId)

  if (selected) {
    return (
      <div className="mt-3 rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm dark:border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong>
              {selected.firstName} {selected.lastName}
            </strong>
            {selected.blockedReason && (
              <span className="ml-2 text-amber-800 dark:text-amber-300">
                {selected.blockedReason}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              onSelect(null)
              setQuery('')
            }}
            className="text-neutral-600 underline"
          >
            Choose someone else
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name"
        aria-label="Search for a member"
        className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
      />

      {query.trim() && matches.length === 0 && (
        <p className="mt-2 text-sm text-neutral-600">
          Nobody matches &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

      {matches.length > 0 && (
        <ul className="mt-2 max-h-64 divide-y divide-neutral-200 overflow-y-auto rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p)}
                className="flex w-full flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900/50"
              >
                <span>
                  {p.firstName} {p.lastName}
                </span>
                {/* Stated rather than hidden. Somebody looking for a member who
                    cannot be texted needs the reason, not an absence. */}
                {p.blockedReason && (
                  <span className="text-neutral-600">{p.blockedReason}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

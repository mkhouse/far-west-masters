'use client'

/**
 * Choose who to message, by name.
 *
 * One person most of the time — the templates are written to open with somebody's
 * first name — but a handful is an equally real need. "These four racers still have
 * not signed the waiver" should not require creating a permanent recipient group and
 * then remembering to delete it.
 *
 * Filter-as-you-type over a list already on the page, the same approach as the group
 * member picker: a plain `<select>` of 293 names cannot be typed into.
 *
 * TWO DELIBERATE CHOICES, both about what is shown rather than what is sent:
 *
 * 1. **Everybody is listed, not only people who can be texted.** Somebody who has not
 *    opted in still appears, with the reason. Quietly omitting them turns "why is Bob
 *    not in this list?" into a mystery with no way to answer it from the screen you
 *    are on. This matches the members directory, which exists to answer that.
 *
 * 2. **Selecting an unreachable person is allowed, and then the send excludes them.**
 *    The server re-resolves the audience and applies the consent gate regardless, so
 *    this cannot send anything; what it does is show the reason against the person
 *    you asked about. Preventing the selection would hide the explanation.
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
  selectedIds,
  onChange,
}: {
  people: PersonOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => people.find((p) => p.id === id))
        .filter((p): p is PersonOption => Boolean(p)),
    [people, selectedIds]
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people
      .filter((p) => !selectedIds.includes(p.id))
      .filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q))
      .slice(0, VISIBLE_LIMIT)
  }, [people, selectedIds, query])

  function add(person: PersonOption) {
    onChange([...selectedIds, person.id])
    setQuery('')
  }

  function remove(id: string) {
    onChange(selectedIds.filter((selectedId) => selectedId !== id))
  }

  return (
    <div className="mt-3">
      {/* Chosen people, each removable. Shown above the search so the list being
          built stays visible while adding to it. */}
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {selected.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-full border border-neutral-300 bg-surface px-3 py-1 text-sm dark:border-neutral-700"
            >
              <span>
                {p.firstName} {p.lastName}
              </span>
              {/* The reason travels with the name, so a person who cannot be texted
                  is visibly in the list and visibly not going to receive anything. */}
              {p.blockedReason && (
                <span className="text-amber-800 dark:text-amber-300">
                  {p.blockedReason}
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.firstName} ${p.lastName}`}
                className="text-neutral-600 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={selected.length ? 'Add someone else' : 'Search by name'}
        aria-label="Search for a member"
        className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
      />

      {query.trim() && matches.length === 0 && (
        <p className="mt-2 text-sm text-neutral-600">
          Nobody else matches &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

      {matches.length > 0 && (
        <ul className="mt-2 max-h-64 divide-y divide-neutral-200 overflow-y-auto rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => add(p)}
                className="flex w-full flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900/50"
              >
                <span>
                  {p.firstName} {p.lastName}
                </span>
                {p.blockedReason && (
                  <span className="text-neutral-600">{p.blockedReason}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The consequence of adding a second person, said where the decision is made
          rather than discovered later next to the send button. */}
      {selected.length > 1 && (
        <p className="mt-2 text-sm text-neutral-600">
          One message goes to all {selected.length}, so it cannot address anybody by
          name. Send to one person at a time to use {'{first name}'}.
        </p>
      )}
    </div>
  )
}

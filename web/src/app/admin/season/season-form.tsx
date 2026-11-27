'use client'

import { useActionState } from 'react'
import { saveSeasonRules, type SaveResult } from './actions'

export function SeasonForm({
  seasonId,
  bestN,
  minStarts,
  counting,
  isAdmin,
}: {
  seasonId: string
  /** Pre-filled with the computed value when nothing is set yet. */
  bestN: number
  minStarts: number
  counting: number
  isAdmin: boolean
}) {
  const [result, action, pending] = useActionState<SaveResult | null, FormData>(
    saveSeasonRules,
    null
  )

  if (result?.ok) {
    return (
      <div className="mt-6 rounded-lg border border-fwm-navy/40 bg-fwm-navy/5 p-4">
        <p className="font-medium">Scoring rules saved</p>
        <p className="mt-1 text-sm">{result.message}</p>
        <p className="mt-3 text-sm text-neutral-600">
          Races will now score. Reload this page to see the saved values.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="season_id" value={seasonId} />

      <div className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
        <label className="block">
          <span className="text-sm font-medium">Best-N</span>
          <span className="mt-0.5 block text-sm text-neutral-600">
            How many of a racer&rsquo;s results count. 75% of the {counting}{' '}
            counting races, rounded up &mdash; the club&rsquo;s published rule.
          </span>
          <input
            name="best_n"
            type="number"
            min={1}
            max={counting}
            defaultValue={bestN}
            className="mt-2 w-24 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-medium">Minimum starts for an award</span>
          {/* Said here because the system cannot apply it. */}
          <span className="mt-0.5 block text-sm text-neutral-600">
            Waivable for racers 70 and over, and individually by the awards
            committee for injury or illness. Neither waiver is recorded anywhere
            in this system.
          </span>
          <input
            name="min_starts"
            type="number"
            min={0}
            defaultValue={minStarts}
            className="mt-2 w-24 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
          />
        </label>
      </div>

      {result && !result.ok && (
        <p className="rounded-md border border-fwm-burgundy/40 bg-fwm-burgundy/5 px-3 py-2 text-sm text-fwm-burgundy">
          {result.error}
        </p>
      )}

      {isAdmin ? (
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-fwm-navy/40 bg-fwm-navy/5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save these rules'}
        </button>
      ) : (
        <p className="text-sm text-neutral-600">
          Only an admin can change how a season is scored.
        </p>
      )}
    </form>
  )
}

'use client'

import { useActionState } from 'react'
import { saveLiveTimingId, type SaveIdResult } from './actions'
import type { DailyRace } from '@/lib/live-timing'

export function RaceIdForm({
  raceId,
  current,
  suggestedId,
  reason,
  candidates,
}: {
  raceId: string
  current: number | null
  suggestedId: string | null
  reason: string
  candidates: DailyRace[]
}) {
  const [result, action, pending] = useActionState<SaveIdResult | null, FormData>(
    saveLiveTimingId,
    null
  )

  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="race_id" value={raceId} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-neutral-600">
          Live-timing id
          <input
            name="live_timing_id"
            inputMode="numeric"
            defaultValue={current ?? suggestedId ?? ''}
            placeholder="not set"
            className="ml-2 w-28 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-fwm-navy/40 bg-fwm-navy/5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {pending ? 'Saving…' : current ? 'Update' : 'Save'}
        </button>
        {result?.ok && <span className="text-sm text-fwm-teal-text">{result.message}</span>}
        {result && !result.ok && (
          <span className="text-sm text-fwm-burgundy">{result.error}</span>
        )}
      </div>

      {/* The evidence, not just the answer. The officer is confirming, and
          cannot confirm a bare number — the race name and start time are what
          make it checkable against what they know happened. */}
      <p className="mt-1 text-sm text-neutral-600">{reason}</p>
      {candidates.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-sm text-neutral-600">
          {candidates.map((c) => (
            <li key={c.id}>
              <code>{c.id}</code> &middot; {c.name.replace(/^[A-Z]=/, '')} &middot;{' '}
              {c.startTime.replace(/^\S+\s/, '')} &middot; {c.venue}
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

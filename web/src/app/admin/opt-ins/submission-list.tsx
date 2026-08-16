'use client'

/**
 * The queue, and what has just been done to it.
 *
 * WHY THIS WRAPPER EXISTS. The outcome used to be held inside each card, which read
 * fine and did not work: approving a submission revalidates the page, the row stops
 * being pending, the server sends a shorter list, and the card unmounts — taking the
 * message with it before anyone can read it. Melissa hit this on the first real use.
 *
 * The outcome therefore lives here, keyed by submission id, in a component that
 * survives the list changing underneath it. Resolved rows are rendered from this
 * state whether or not the server still returns them, so the record of what happened
 * stays on screen until the officer navigates away.
 *
 * That matters more than tidiness. The message says whether the intro text actually
 * went out, and losing it means an officer cannot tell a member who was texted from
 * one who was not.
 */

import { useState } from 'react'
import { SubmissionCard } from './submission-card'
import type { ActionResult } from './actions'
import type { PendingSubmission } from '@/lib/opt-in-review'

export function SubmissionList({ pending }: { pending: PendingSubmission[] }) {
  // Keyed by submission id, and kept for the life of the page.
  const [done, setDone] = useState<Record<string, { name: string; result: ActionResult }>>({})

  // Anything still awaiting a decision, minus what has just been decided here — the
  // server list can lag a moment behind the action that changed it.
  const waiting = pending.filter((s) => !done[s.id])

  return (
    <>
      {/* Resolved first: it is what just happened, and what the officer is looking
          for immediately after clicking. */}
      {Object.entries(done).length > 0 && (
        <ul className="mt-8 space-y-3">
          {Object.entries(done).map(([id, { name, result }]) => (
            <li
              key={id}
              className={`rounded-lg border p-4 ${
                result.ok
                  ? 'border-fwm-navy/40 bg-fwm-navy/5'
                  : 'border-fwm-burgundy/40 bg-fwm-burgundy/5'
              }`}
            >
              <p className="font-medium">{name}</p>
              <p className="mt-1 text-sm">{result.ok ? result.message : result.error}</p>
            </li>
          ))}
        </ul>
      )}

      {waiting.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600 dark:border-neutral-700">
          {Object.keys(done).length > 0
            ? 'Nothing else waiting.'
            : 'Nothing waiting. Submissions that match a member on their mobile number are linked and introduced automatically — only the rest arrive here.'}
        </p>
      ) : (
        <>
          <p className="mt-8 text-sm text-neutral-600">
            {waiting.length} waiting, oldest first
          </p>
          <ul className="mt-3 space-y-3">
            {waiting.map((submission) => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                onResolved={(result) =>
                  // Only a success removes the row. A failed action — a stale match,
                  // a USSA clash — leaves the card in place so the officer can read
                  // the reason and try the other button.
                  result.ok &&
                  setDone((prev) => ({
                    ...prev,
                    [submission.id]: {
                      name: `${submission.first_name} ${submission.last_name}`,
                      result,
                    },
                  }))
                }
              />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

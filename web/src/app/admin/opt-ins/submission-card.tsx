'use client'

/**
 * One submission awaiting a decision.
 *
 * The card leads with what the person typed, because that — not our interpretation
 * of it — is what the officer is being asked to judge. The match, when there is one,
 * is offered as a suggestion with the reason it was made, so a wrong match can be
 * seen rather than accepted by default.
 *
 * Only the actions that make sense are shown. Where a member already matches, there
 * is no "create" button: creating would duplicate them, and offering a button whose
 * only outcome is an error message wastes the officer's time. The server refuses it
 * regardless — a rule the interface alone enforces is not a rule.
 */

import { useState, useTransition } from 'react'
import {
  createFromSubmission,
  linkSubmission,
  rejectSubmission,
  type ActionResult,
} from './actions'
import type { PendingSubmission } from '@/lib/opt-in-review'
import { formatPhone } from '@/lib/format'

/** How each match was made, said plainly. */
const MATCHED_BY: Record<string, string> = {
  phone: 'same mobile number',
  email: 'same email address',
  usssa: 'same USSA number',
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  const when = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  if (days <= 0) return `${when} (today)`
  if (days === 1) return `${when} (yesterday)`
  return `${when} (${days} days ago)`
}

export function SubmissionCard({
  submission,
  onResolved,
}: {
  submission: PendingSubmission
  /** Told what happened, so the outcome outlives this card. See submission-list. */
  onResolved: (result: ActionResult) => void
}) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult | null>(null)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const { match, matchedBy, phoneChange } = submission

  function run(
    action: (fd: FormData) => Promise<ActionResult>,
    extra: Record<string, string> = {}
  ) {
    const fd = new FormData()
    fd.set('submission_id', submission.id)
    for (const [k, v] of Object.entries(extra)) fd.set(k, v)
    startTransition(async () => {
      const outcome = await action(fd)
      setResult(outcome)
      // The list owns the record of what happened: revalidation removes this row
      // from the server data and unmounts the card, which is how the confirmation
      // message used to disappear before it could be read.
      onResolved(outcome)
    })
  }

  return (
    <li className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {submission.first_name} {submission.last_name}
        </p>
        <p className="text-sm text-neutral-600">{formatWhen(submission.created_at)}</p>
      </div>

      {/* Exactly what they typed. phone_raw rather than the normalised number: if
          normalisation is why this is unmatched, the raw value is the evidence. */}
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-neutral-600">Mobile</dt>
          <dd>
            {submission.phone_raw}
            {!submission.phone && (
              <span className="ml-2 text-fwm-burgundy">could not be read as a number</span>
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-neutral-600">Email</dt>
          <dd className="truncate">{submission.email}</dd>
        </div>
        {submission.usssa && (
          <div className="flex gap-2">
            <dt className="text-neutral-600">USSA</dt>
            <dd>{submission.usssa}</dd>
          </div>
        )}
      </dl>

      {/* The suggestion, with its reason. Checked again when an action runs — this
          page may have been open a while, and the membership import may have created
          the very person it says is missing. */}
      <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-900/50">
        {match ? (
          <>
            Matches{' '}
            <strong>
              {match.first_name} {match.last_name}
            </strong>{' '}
            <span className="text-neutral-600">
              ({MATCHED_BY[matchedBy ?? ''] ?? 'identifier'}
              {match.opt_in_at && ', already opted in'})
            </span>
          </>
        ) : (
          <span className="text-neutral-600">
            No member matches this on mobile, email or USSA number.
          </span>
        )}
      </p>

      {/* The number is changing. Said before the click, not reported after it: a
          member's mobile number moving is consequential, and the officer should be
          agreeing to it rather than discovering it. */}
      {phoneChange?.changed && (
        <p className="mt-2 rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
          On file as <strong>{formatPhone(phoneChange.from)}</strong>, and this form
          gives <strong>{formatPhone(phoneChange.phone)}</strong>. Linking will use the
          number from the form — that is where they have asked to be texted.
        </p>
      )}

      {result?.error && (
        <p className="mt-3 rounded-md border border-fwm-burgundy/40 bg-fwm-burgundy/5 px-3 py-2 text-sm text-fwm-burgundy">
          {result.error}
        </p>
      )}

      {rejecting ? (
        <div className="mt-3">
          <label className="block text-sm text-neutral-600" htmlFor={`reason-${submission.id}`}>
            Why is this being rejected? Recorded, so the same one is not re-examined later.
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={`reason-${submission.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Test submission, duplicate, obvious spam…"
              className="flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700"
            />
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => run(rejectSubmission, { reason })}
              className="rounded-md border border-fwm-burgundy/40 px-3 py-1.5 text-sm text-fwm-burgundy disabled:opacity-40"
            >
              {pending ? 'Rejecting…' : 'Confirm reject'}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-600"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {match ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(linkSubmission)}
                className="rounded-md border border-fwm-navy/40 bg-fwm-navy/5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                {pending
                  ? 'Linking…'
                  : phoneChange?.changed
                    ? `Link to ${match.first_name} ${match.last_name}, use the new number, send intro`
                    : `Link to ${match.first_name} ${match.last_name} and send intro`}
              </button>
              {/* The escape hatch, offered only when there is something to escape.
                  Until member admin exists (#59) there is no other way to undo a
                  number changed by a typo on a public form. */}
              {phoneChange?.changed && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(linkSubmission, { keep_phone: 'on' })}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-neutral-700"
                >
                  Link but keep {formatPhone(phoneChange.from)}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(createFromSubmission)}
              className="rounded-md border border-fwm-navy/40 bg-fwm-navy/5 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              {pending ? 'Adding…' : 'Add as new, opted-in for texts'}
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => setRejecting(true)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-neutral-700"
          >
            Reject
          </button>
        </div>
      )}
    </li>
  )
}

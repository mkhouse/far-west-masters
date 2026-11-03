'use client'

/**
 * A submit button that shows it is working.
 *
 * Server actions take a round trip, and several here take considerably longer than
 * that — approving an opt-in sends a text, applying a schedule writes twenty-odd
 * rows. A button that sits inert for two seconds is indistinguishable from one that
 * did not register the click, and the reasonable response to that is to click again.
 *
 * WHY THE BUTTON IS REPLACED RATHER THAN DISABLED. A greyed-out button still reads
 * as something you might click harder; a spinner reads as work in progress. Removing
 * the control entirely also means there is nothing left to double-submit, which is
 * the actual failure being prevented — and on the screens that send texts, a second
 * submission is not something you can take back.
 *
 * This is the pattern the compose and sign-in screens already used, extracted so the
 * rest of the application stops being the exception.
 */

import { useFormStatus } from 'react-dom'

/** Spinning ring. aria-hidden: the surrounding status text is what gets announced. */
function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function SubmitButton({
  children,
  pending: pendingLabel,
  className = '',
  disabled,
}: {
  children: React.ReactNode
  /** What it says while working. Defaults to the label with an ellipsis. */
  pending?: string
  className?: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()

  if (pending) {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center justify-center gap-2 ${className}`}
      >
        <Spinner />
        {pendingLabel ?? `${typeof children === 'string' ? children : 'Working'}…`}
      </span>
    )
  }

  return (
    <button type="submit" disabled={disabled} className={className}>
      {children}
    </button>
  )
}

/**
 * The quiet variant: a text link that becomes plain text while working.
 *
 * For the secondary actions — archive, remove, restore — where a filled button would
 * overstate the thing. Same contract: while pending there is nothing to click.
 */
export function SubmitLink({
  children,
  pending: pendingLabel,
  className = 'text-sm text-neutral-600 underline',
}: {
  children: React.ReactNode
  pending?: string
  className?: string
}) {
  const { pending } = useFormStatus()

  if (pending) {
    return (
      <span role="status" aria-live="polite" className="text-sm text-neutral-600">
        {pendingLabel ?? 'Working…'}
      </span>
    )
  }

  return (
    <button type="submit" className={className}>
      {children}
    </button>
  )
}

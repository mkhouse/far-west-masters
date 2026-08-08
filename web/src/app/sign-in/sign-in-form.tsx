'use client'

/**
 * The sign-in form, with a visible pending state.
 *
 * This exists as a client component for one reason: a form that sits silently
 * while a request is in flight is indistinguishable from a broken button. That is
 * not hypothetical — a misconfigured SMTP host made this form hang for thirty
 * seconds, and the reasonable conclusion from the outside was that the button did
 * not work.
 *
 * Sending mail through someone else's server can always be slow. The form should
 * say so rather than leave an officer clicking.
 */

import { useFormStatus } from 'react-dom'
import { requestMagicLink } from './actions'

/** Spinning ring. Marked aria-hidden — the surrounding status text is what a
 *  screen reader should announce, not a description of an animation. */
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

/**
 * Must be a separate component: `useFormStatus` reports the status of the nearest
 * enclosing form, so it has to be rendered *inside* the form rather than beside it.
 */
function SubmitButton() {
  const { pending } = useFormStatus()

  // While sending, the button is REPLACED rather than disabled. A greyed-out
  // button still reads as something you might click harder; a spinner reads as
  // work in progress. Removing the control entirely also means there is nothing
  // left to double-submit, which is the actual failure being prevented — each
  // extra request burns a send against the rate limit and pushes the real email
  // further away.
  if (pending) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
      >
        <Spinner />
        Sending your sign-in link…
      </div>
    )
  }

  return (
    <button
      type="submit"
      className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
    >
      Email me a sign-in link
    </button>
  )
}

/** The email field, dimmed once the form is committed. Same reasoning as the
 *  button: the whole form should look busy, not just one control. */
function EmailField() {
  const { pending } = useFormStatus()

  return (
    <div>
      <label htmlFor="email" className="block text-sm font-medium">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        // readOnly rather than disabled: a disabled field is dropped from the form
        // data, and Next re-submits on retry. readOnly keeps the value while still
        // refusing edits.
        readOnly={pending}
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm read-only:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
      />
    </div>
  )
}

export function SignInForm({ next, error }: { next: string; error?: string }) {
  return (
    <form action={requestMagicLink} className="mt-8 space-y-4">
      {/* Preserve where the officer was headed before being redirected here. */}
      <input type="hidden" name="next" value={next} />

      <EmailField />
      <SubmitButton />

      {/* Errors from the action arrive as a query parameter after a redirect, so
          this renders on a fresh page load rather than in place. `role="alert"`
          makes a screen reader announce it, which it otherwise would not. */}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

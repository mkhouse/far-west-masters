/**
 * Officer sign-in.
 *
 * Magic link only — no passwords to manage, reset, or leak for a handful of
 * volunteer officers.
 *
 * Worth understanding: requesting a link is not the same as being granted access.
 * Anyone can enter an email here and receive one. Access requires a matching row in
 * `app_users`, which only an admin can create — so a stranger who signs in
 * successfully still sees nothing. See lib/auth.ts.
 */

import { requestMagicLink } from './actions'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string
    sent?: string
    error?: string
    signed_out?: string
  }>
}) {
  const params = await searchParams

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Far West Masters</h1>
      <p className="mt-1 text-sm text-neutral-500">Officer sign-in</p>

      {/* Confirm the sign-out actually happened. Landing on a login form is
          ambiguous otherwise — it looks the same as a session that expired, or a
          click that did nothing, which is a bad thing to be unsure about on a
          shared laptop. */}
      {params.signed_out ? (
        <p className="mt-6 rounded-lg border border-neutral-200 p-3 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
          You are signed out.
        </p>
      ) : null}

      {params.sent ? (
        <div className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          <p className="font-medium">Check your email</p>
          <p className="mt-1 text-neutral-600 dark:text-neutral-400">
            If that address is registered, a sign-in link is on its way. The link is
            single-use and expires shortly.
          </p>
        </div>
      ) : (
        <form action={requestMagicLink} className="mt-8 space-y-4">
          {/* Preserve where the officer was headed before being redirected here. */}
          <input type="hidden" name="next" value={params.next ?? '/'} />

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
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
          >
            Email me a sign-in link
          </button>

          {params.error ? (
            <p className="text-sm text-red-600" role="alert">
              {params.error}
            </p>
          ) : null}
        </form>
      )}

      <p className="mt-8 text-xs text-neutral-500">
        Race results and standings are public and need no sign-in.
      </p>
    </main>
  )
}

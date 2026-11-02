/**
 * What to show an officer when a sign-in email fails to send.
 *
 * Pure string handling, deliberately not `server-only` — same reasoning as
 * format.ts and phone.ts.
 *
 * WHY THIS EXISTS. The sign-in action showed `error.message` from Supabase verbatim.
 * On 2 November 2026 the mailbox password changed, Supabase returned an error whose
 * message was the literal string "{}", and the page rendered a red "{}" and nothing
 * else. The real cause — `535 "5.7.8 Error: authentication failed"` — existed only in
 * Supabase's own auth logs, which you have to know to go looking for.
 *
 * An error message that says nothing is worse than no error message: it reads as the
 * application being broken in some unknowable way, and gives whoever sees it nowhere
 * to start.
 *
 * WHAT THIS DOES NOT DO: invent a cause. "{}" means Supabase declined to say what
 * went wrong, and the honest reply is that sending failed and where the real answer
 * is kept — not a guess at which of several things it was.
 */

/**
 * Messages that carry no information, whatever they look like.
 *
 * `{}` is a JSON body with no recognised error field; `[object Object]` is the same
 * failure one layer up. Both mean "something went wrong and nobody said what".
 */
const EMPTY_MESSAGES = new Set(['', '{}', '[]', '[object object]', 'null', 'undefined'])

/** Is this message worth showing to the person who just pressed the button? */
export function isUselessErrorMessage(raw: string | null | undefined): boolean {
  return EMPTY_MESSAGES.has(String(raw ?? '').trim().toLowerCase())
}

/**
 * The message to put on the sign-in page.
 *
 * A meaningful message from Supabase is passed through — "email rate limit exceeded"
 * and "you can only request this after 48 seconds" are exactly what somebody needs to
 * read, and replacing them with something vaguer would be a downgrade.
 *
 * An empty one is replaced with a statement of what is actually known: the email did
 * not send, it is not the officer's fault, and the detail is in the auth logs.
 */
export function signInErrorMessage(raw: string | null | undefined): string {
  if (!isUselessErrorMessage(raw)) return String(raw).trim()

  return (
    'Could not send the sign-in email. This is a problem at our end, not with your ' +
    'address — the email service is refusing to send. See RUNBOOK.md ' +
    '("Sign-in emails never arrive") for where to look.'
  )
}

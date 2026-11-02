/**
 * Which hostnames serve nothing but the opt-in form.
 *
 * Pure string handling, deliberately not `server-only` — same reasoning as
 * format.ts and phone.ts. It lives here rather than inline in proxy.ts because of
 * what it decides: whether a request reaches the officer tooling or is sent back to
 * the form. A rule with that consequence is worth pinning down in tests, and the
 * proxy itself cannot easily be tested without a request.
 *
 * WHY A PATTERN RATHER THAN A LIST. Preview deployments get generated hostnames, and
 * an exact list would mean the opt-in host behaves one way in production and another
 * way everywhere else — which is how a difference gets discovered in production.
 *
 * WHY "ENDS WITH", NOT "STARTS WITH". This matched `optin.` as a prefix until the
 * club chose `fwm-messaging-optin.mkinthehouse.com`, which the prefix form silently
 * fails to match: the host would have served the whole application, and `/` would
 * have redirected members to the officer sign-in instead of the form. Matching the
 * END of the first label covers both namings.
 *
 * And why not "contains"? A git branch called `optin-something` produces a preview
 * host like `far-west-masters-web-git-optin-something-abc123.vercel.app`, which
 * "contains" would turn into a form-only deployment for reasons nobody would guess.
 */

/**
 * The first label of the hostname ends with "optin".
 *
 *   optin.mkinthehouse.com                 -> yes
 *   fwm-messaging-optin.mkinthehouse.com   -> yes
 *   fwm-results.mkinthehouse.com           -> no
 *
 * Anchored at the start and bounded by the first dot, so only the leftmost label is
 * considered: a hostname can never qualify because of something further to the
 * right, which is where an attacker-chosen value would sit.
 */
const OPT_IN_HOST = /^[^.]*optin\./i

/** Does this Host header name a hostname that serves only the opt-in form? */
export function isOptInHost(host: string | null | undefined): boolean {
  return OPT_IN_HOST.test(String(host ?? ''))
}

/**
 * Paths that must keep working on the opt-in host: the form, and Next's own assets.
 *
 * Everything else is sent back to the form rather than 404ing — somebody typing a
 * stray path on that hostname is a member looking for the form, not an officer
 * looking for the application.
 */
export function allowedOnOptInHost(path: string): boolean {
  return (
    path === '/' ||
    path === '/opt-in' ||
    path.startsWith('/_next/') ||
    path === '/favicon.ico'
  )
}

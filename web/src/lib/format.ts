/**
 * Display formatting, safe on both sides of the client boundary.
 *
 * Note the absence of `import 'server-only'`, which nearly every other module in
 * lib/ carries. That marker is right for anything touching the database, Twilio or
 * a key — it makes "this must never reach a browser" a build error rather than a
 * hope. It is wrong for pure formatting: a client component has every reason to
 * render a phone number, and marking this server-only would only push each one into
 * keeping its own copy.
 *
 * So the rule for this file: nothing that reads a secret, a request, or the
 * database. If something here ever needs any of those, it belongs elsewhere.
 */

/**
 * Format a phone number for reading, not for dialling.
 *
 * Stored as E.164 because that is what Twilio needs; +15305551234 is hard to read
 * and hard to check against a number someone reads out over the phone.
 */
export function formatPhone(phone: string | null): string {
  if (!phone) return '—'
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone)
  // Anything that does not fit the pattern is shown as it is. Better to show
  // something unexpected than to hide it: a number in an odd shape is exactly the
  // one somebody needs to see in order to fix it.
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone
}

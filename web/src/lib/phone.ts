/**
 * Phone normalisation.
 *
 * Deliberately NOT marked `server-only`, unlike most of lib/ — see lib/format.ts for
 * the same reasoning. There is no key, request or database here, only string
 * handling, and marking it server-only twice blocked code that had every right to
 * use it: first the phone number shown on a review card, then the membership import
 * preview. A guard that only ever stops legitimate callers is not protecting
 * anything.
 *
 * Twilio needs E.164 (+15305551234). People type anything: the two roster exports
 * alone contained seven shapes — bare digits, dashes, parentheses, spaces, a
 * leading 1, and a Canadian number.
 *
 * A number that fails to normalise is not silently dropped. The raw text is kept
 * alongside, and the submission is held for review — losing somebody because of a
 * punctuation mark is worse than asking a human to look.
 */

/** Digits only, with a leading US/Canada country code removed. */
export function phoneDigits(raw: string | null | undefined): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d
}

/**
 * To E.164, or null when it cannot be trusted.
 *
 * Deliberately strict about length: a nine-digit number is a typo, not a phone
 * number, and sending to it would fail at Twilio anyway — later, and less
 * usefully, than refusing it here.
 *
 * North America only, which is what this club is. A member with an international
 * number would need review, and returning null is how that happens.
 */
export function toE164(raw: string | null | undefined): string | null {
  const d = phoneDigits(raw)
  return d.length === 10 ? `+1${d}` : null
}

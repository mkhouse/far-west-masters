import 'server-only'

import twilio from 'twilio'
import type { NextRequest } from 'next/server'

/**
 * Verify that a webhook request genuinely came from Twilio.
 *
 * Twilio signs each request over the exact URL it called. Reconstructing that URL
 * is the fiddly part, and getting it wrong fails in the worst possible way: every
 * request is rejected with a 403, which from the outside is indistinguishable from
 * Twilio never calling at all. Replies vanish and delivery reports stop, silently.
 *
 * So the URL is derived from the request itself rather than from configuration.
 * Vercel terminates TLS and forwards the original host, so the headers below
 * describe what Twilio actually dialled — which is what was signed. A configured
 * NEXT_PUBLIC_SITE_URL is tried as a fallback, but nothing depends on it being
 * right, and changing the site's domain no longer breaks both webhooks until
 * somebody notices.
 *
 * Trying two candidate URLs does not weaken anything: each is checked against the
 * signature, and forging one still requires the auth token. A spoofed Host header
 * buys an attacker nothing.
 *
 * @param path  The webhook's own path, e.g. '/api/twilio/inbound'.
 */
export function verifyTwilioSignature(
  request: NextRequest,
  path: string,
  params: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    // A misconfiguration rather than an attack, but it must fail closed: without
    // the token there is no way to tell the two apart.
    console.error('TWILIO_AUTH_TOKEN not set — cannot verify webhook requests')
    return false
  }

  const signature = request.headers.get('x-twilio-signature')
  if (!signature) return false

  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')

  const candidates = [
    host ? `${proto}://${host}${path}` : null,
    process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}${path}`
      : null,
  ].filter(Boolean) as string[]

  for (const url of candidates) {
    if (twilio.validateRequest(authToken, signature, url, params)) return true
  }

  // Log what was tried. A rejected webhook produces no other trace, and "we tried
  // these URLs and none matched" is the difference between a five-minute fix and
  // an evening of guessing.
  console.error(
    `Twilio signature did not match any candidate URL: ${candidates.join(', ')}`
  )
  return false
}

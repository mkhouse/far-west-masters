/**
 * Twilio client.
 *
 * Kept deliberately thin: this file knows how to put one message on the wire and
 * nothing about who should receive it. Audience rules and the consent gate live in
 * lib/audiences.ts, so there is no path by which a bug here could widen who gets
 * messaged.
 */
import 'server-only'

import twilio from 'twilio'

export interface TwilioConfig {
  accountSid: string
  authToken: string
  fromNumber: string
  /** Where inbound replies are forwarded when a message has no specific contact */
  defaultForwardTo: string | null
}

/**
 * Read Twilio configuration, or explain precisely what is missing.
 *
 * Returns a reason rather than throwing, so the compose screen can say "sending is
 * not configured yet" instead of failing at the moment someone presses send.
 */
export function twilioConfig(): { config: TwilioConfig } | { missing: string[] } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_FROM_NUMBER

  const missing: string[] = []
  if (!accountSid) missing.push('TWILIO_ACCOUNT_SID')
  if (!authToken) missing.push('TWILIO_AUTH_TOKEN')
  if (!fromNumber) missing.push('TWILIO_FROM_NUMBER')
  if (missing.length) return { missing }

  return {
    config: {
      accountSid: accountSid!,
      authToken: authToken!,
      fromNumber: fromNumber!,
      defaultForwardTo: process.env.SMS_FORWARD_TO_NUMBER ?? null,
    },
  }
}

export interface SendResult {
  to: string
  sid?: string
  status?: string
  segments?: number
  error?: string
  errorCode?: string
}

/**
 * Send one message.
 *
 * Errors are returned rather than thrown. A send to 93 people must not stop at the
 * first bad number — one disconnected phone should cost one recipient, not
 * ninety-two.
 *
 * @param statusCallback  URL Twilio calls as delivery state changes. Without it a
 *                        message is only ever known to be "accepted", which is not
 *                        the same as delivered.
 */
export async function sendOne(
  config: TwilioConfig,
  to: string,
  body: string,
  statusCallback?: string
): Promise<SendResult> {
  const client = twilio(config.accountSid, config.authToken)

  try {
    const msg = await client.messages.create({
      to,
      from: config.fromNumber,
      body,
      ...(statusCallback ? { statusCallback } : {}),
    })
    return {
      to,
      sid: msg.sid,
      status: msg.status,
      segments: msg.numSegments ? parseInt(msg.numSegments, 10) : undefined,
    }
  } catch (e) {
    const err = e as { message?: string; code?: number | string }
    return {
      to,
      error: err.message ?? 'Unknown error',
      errorCode: err.code != null ? String(err.code) : undefined,
    }
  }
}

/**
 * Send to many recipients, in small concurrent batches.
 *
 * Twilio accepts messages faster than a phone number can actually emit them — a
 * long code sends roughly one segment per second, so a 93-person send takes a
 * couple of minutes regardless. The batching here is about not opening ninety
 * simultaneous connections, not about throughput.
 *
 * @param onProgress  Called after each batch, so a long send can report progress
 *                    rather than appearing to hang.
 */
export async function sendMany(
  config: TwilioConfig,
  recipients: Array<{ personId: string | null; phone: string }>,
  body: string,
  opts: { statusCallback?: string; batchSize?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<Array<SendResult & { personId: string | null }>> {
  const { statusCallback, batchSize = 10, onProgress } = opts
  const results: Array<SendResult & { personId: string | null }> = []

  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize)
    const settled = await Promise.all(
      batch.map(async (r) => ({
        ...(await sendOne(config, r.phone, body, statusCallback)),
        personId: r.personId,
      }))
    )
    results.push(...settled)
    onProgress?.(results.length, recipients.length)
  }

  return results
}

// Message assembly deliberately does NOT live here. `composeBody` sits in
// segments.ts, beside the segment counter, so that what is measured and what is
// sent are built by the same code and cannot disagree.

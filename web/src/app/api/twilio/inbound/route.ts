/**
 * Inbound SMS webhook.
 *
 * Replaces the Studio "Autoresponder" flow, which replies to everything with the
 * same "we cannot respond" message. This routes each reply to whoever should answer
 * it, based on the message it appears to be answering.
 *
 * Twilio configuration: Phone Numbers → the FWM number → Messaging → "A message
 * comes in" → Webhook, POST, this URL.
 *
 * Everything here is defensive about one thing above all: **STOP must always work**.
 * Twilio handles opt-out itself before this endpoint is reached, but the suppression
 * is recorded here too, so our own sends honour it even if Twilio's list and our
 * database ever diverge.
 */

import { NextResponse, type NextRequest } from 'next/server'
import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendOne, twilioConfig } from '@/lib/sms/twilio'

/** Words Twilio treats as opt-out. Recorded here as well, never only there. */
const STOP_WORDS = new Set([
  'stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'stop all',
])

/** Words Twilio treats as opt-in, undoing a previous STOP. */
const START_WORDS = new Set(['start', 'yes', 'unstop'])

/**
 * Verify the request genuinely came from Twilio.
 *
 * Without this the endpoint is a public API for writing into the messages log and
 * triggering forwarded texts to officers. The signature check is the only thing
 * standing between that and the open internet.
 *
 * Skipped only when no auth token is configured, which is a misconfiguration rather
 * than a mode — and it is logged loudly.
 */
function verifySignature(
  authToken: string | undefined,
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  if (!authToken) {
    console.error('TWILIO_AUTH_TOKEN not set — inbound webhook cannot verify requests')
    return false
  }
  if (!signature) return false
  return twilio.validateRequest(authToken, signature, url, params)
}

/** Twilio expects TwiML. An empty response means "say nothing back". */
function twiml(message?: string) {
  const body = message
    ? `<Response><Message>${message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</Message></Response>`
    : '<Response></Response>'
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(request: NextRequest) {
  const form = await request.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = String(v)

  const signature = request.headers.get('x-twilio-signature')
  const url =
    (process.env.NEXT_PUBLIC_SITE_URL ?? '') + '/api/twilio/inbound'

  if (!verifySignature(process.env.TWILIO_AUTH_TOKEN, signature, url, params)) {
    return new NextResponse('Invalid signature', { status: 403 })
  }

  const from = params.From ?? ''
  const body = (params.Body ?? '').trim()
  const sid = params.MessageSid ?? null
  const normalised = body.toLowerCase().replace(/[^a-z ]/g, '')

  const db = supabaseAdmin()

  // Who is this? Unknown numbers are still recorded — a reply from someone we
  // cannot identify is exactly the kind of thing that needs a human to look at.
  const { data: person } = await db
    .from('people')
    .select('id, first_name, last_name')
    .eq('phone', from)
    .maybeSingle()

  const personId = (person?.id as string) ?? null

  // The most recent message sent to this number determines where a reply goes.
  // Best-effort by design: someone replying days later, after a newer message, will
  // route to the newer one. In practice replies arrive within hours.
  const { data: lastSend } = await db
    .from('message_recipients')
    .select('message_id, messages(replies_monitored, reply_forward_to, reply_notice, purpose)')
    .eq('phone', from)
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastMessage = lastSend?.messages as unknown as
    | {
        replies_monitored: boolean
        reply_forward_to: string | null
        reply_notice: string | null
        purpose: string | null
      }
    | undefined

  const isStop = STOP_WORDS.has(normalised)
  const isStart = START_WORDS.has(normalised)

  // --- record the reply before doing anything with it ---
  const { data: inbound } = await db
    .from('inbound_messages')
    .insert({
      from_phone: from,
      person_id: personId,
      body,
      twilio_sid: sid,
      is_stop: isStop,
      in_reply_to_message_id: (lastSend?.message_id as string) ?? null,
    })
    .select('id')
    .single()

  // --- opt-out and opt-in ---
  if (isStop && personId) {
    await db
      .from('people')
      .update({ opted_out_at: new Date().toISOString() })
      .eq('id', personId)
    // Twilio has already replied with its own confirmation and will block further
    // sends to this number. Saying nothing more avoids a duplicate message.
    return twiml()
  }

  if (isStart && personId) {
    await db.from('people').update({ opted_out_at: null }).eq('id', personId)
    return twiml()
  }

  // --- an ordinary reply ---

  // Nobody is watching: log it, acknowledge once, and leave phones alone. The
  // acknowledgement is sent at most once per person per message, so somebody
  // texting three times does not get three replies.
  if (lastMessage && !lastMessage.replies_monitored) {
    const { count: alreadyAcked } = await db
      .from('inbound_messages')
      .select('*', { count: 'exact', head: true })
      .eq('from_phone', from)
      .eq('in_reply_to_message_id', lastSend!.message_id as string)
      .not('auto_replied_at', 'is', null)

    if (inbound) {
      await db
        .from('inbound_messages')
        .update({ forward_suppressed: true, auto_replied_at: new Date().toISOString() })
        .eq('id', inbound.id as string)
    }

    if ((alreadyAcked ?? 0) === 0) {
      return twiml(
        lastMessage.reply_notice ??
          'FWM is not monitoring replies to this message. Please contact membership@farwestmasters.org for help.'
      )
    }
    return twiml()
  }

  // Otherwise forward to whoever owns replies for that message, falling back to the
  // configured default.
  const forwardTo =
    lastMessage?.reply_forward_to ?? process.env.SMS_FORWARD_TO_NUMBER ?? null

  if (forwardTo) {
    const tw = twilioConfig()
    if (!('missing' in tw)) {
      const who = person
        ? `${person.first_name} ${person.last_name}`
        : `unknown number ${from}`
      const context = lastMessage?.purpose ? ` (re: ${lastMessage.purpose})` : ''

      // Include who it is from, because the forwarded message arrives from the FWM
      // number rather than the member's — without this the recipient has no idea
      // who they are replying to.
      await sendOne(tw.config, forwardTo, `From ${who}${context}: ${body}`)

      if (inbound) {
        await db
          .from('inbound_messages')
          .update({ forwarded_to: forwardTo, forwarded_at: new Date().toISOString() })
          .eq('id', inbound.id as string)
      }
    }
  }

  // No automatic reply to the member: a real person will answer.
  return twiml()
}

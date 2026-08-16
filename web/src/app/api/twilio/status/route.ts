/**
 * Delivery status webhook.
 *
 * Twilio accepting a message is not the same as a phone receiving it — a carrier can
 * reject one minutes later, and a disconnected number fails silently otherwise.
 * Without this endpoint every send would look successful regardless of what actually
 * happened.
 *
 * Twilio calls this as each message changes state. Configured per message via
 * `statusCallback`, so it needs no dashboard setup beyond being reachable.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/sms/webhook'
import { isIntroAudience, isPermanentFailure } from '@/lib/delivery'

export async function POST(request: NextRequest) {
  const form = await request.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = String(v)

  // Same reasoning as the inbound webhook: without signature verification this is a
  // public endpoint for rewriting delivery history.
  if (!verifyTwilioSignature(request, '/api/twilio/status', params)) {
    return new NextResponse('Invalid signature', { status: 403 })
  }

  const sid = params.MessageSid
  const status = params.MessageStatus
  if (!sid || !status) return NextResponse.json({ ok: true })

  const db = supabaseAdmin()

  const { data: updated } = await db
    .from('message_recipients')
    .update({
      delivery_status: status,
      // ErrorCode is only present on failure, and is the difference between "we do
      // not know why" and "that number is disconnected".
      error_code: params.ErrorCode ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('twilio_sid', sid)
    .select('person_id, message_id')
    .maybeSingle()

  // --- an intro text that never arrived introduced nobody ---
  //
  // `intro_sent_at` is stamped when Twilio ACCEPTS the message, because that is the
  // only answer available at send time — delivery is reported minutes later, if at
  // all. The consequence, found while testing on 2026-08-16: a message Twilio
  // accepted and the carrier then rejected (error 30006, a landline) left the person
  // marked as introduced. They would sit in every ordinary audience having never
  // heard from the club, and nothing anywhere would say so.
  //
  // So a permanent failure undoes the stamp, and they return to the "needs intro
  // text" audience where they can be sent another.
  //
  // Note what is NOT undone: `opt_in_at`. They consented; it is the club's half that
  // failed. Clearing that would quietly discard a member's decision because of a
  // carrier problem.
  if (updated?.person_id && isPermanentFailure(status)) {
    const { data: message } = await db
      .from('messages')
      .select('audience_kind')
      .eq('id', updated.message_id)
      .maybeSingle()

    // Only intro sends. An ordinary race announcement bouncing says something about
    // that number today; it does not mean the person was never introduced, and
    // un-introducing them over it would drop them out of every audience.
    if (isIntroAudience(message?.audience_kind as string | null)) {
      await db
        .from('people')
        .update({ intro_sent_at: null, updated_at: new Date().toISOString() })
        .eq('id', updated.person_id)
    }
  }

  return NextResponse.json({ ok: true })
}

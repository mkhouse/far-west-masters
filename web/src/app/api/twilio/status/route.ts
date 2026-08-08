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

  await supabaseAdmin()
    .from('message_recipients')
    .update({
      delivery_status: status,
      // ErrorCode is only present on failure, and is the difference between "we do
      // not know why" and "that number is disconnected".
      error_code: params.ErrorCode ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('twilio_sid', sid)

  return NextResponse.json({ ok: true })
}

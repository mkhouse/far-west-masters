import 'server-only'

/**
 * Sending the intro text.
 *
 * The intro is the message that completes somebody's consent: they have opted in on
 * the form, and this is the club's first contact confirming it. Until it has been
 * sent and accepted, they are not in any ordinary audience.
 *
 * It lives here, on its own, because there are now two ways it goes out — the public
 * form sends it automatically on a phone match, and the review queue sends it when an
 * officer approves an unmatched submission. Two copies of this would drift, and the
 * copy that drifted would be the one that sends real texts to real members.
 *
 * It goes through the same tables as a message an officer composes, so the send log
 * shows it, delivery is tracked, and nothing about it is invisible just because
 * nobody pressed a button.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { composeBody } from '@/lib/sms/segments'
import { sendOne, twilioConfig } from '@/lib/sms/twilio'

export interface IntroRequest {
  personId: string
  /** E.164. The caller has already matched or created the person holding it. */
  phone: string
  /** The submission that prompted this, so the outcome can be noted against it. */
  submissionId?: string | null
  /**
   * How the send log should describe where this came from.
   *
   * 'opt_in_auto'   — the form matched a member and sent it with nobody watching
   * 'opt_in_review' — an officer approved a submission in the review queue
   */
  audienceKind: 'opt_in_auto' | 'opt_in_review'
  /** Who to credit. An officer's name, or a plain statement that nobody sent it. */
  sentBy: string
}

export interface IntroResult {
  /** Null when Twilio accepted the message. */
  error: string | null
}

/** Reasons an intro cannot be attempted at all, phrased for an officer to read. */
const NOT_CONFIGURED = 'Twilio is not configured, so no text was sent.'
const NO_INTRO_TEXT = 'No intro text is set in app settings, so nothing was sent.'

export async function sendIntro(req: IntroRequest): Promise<IntroResult> {
  const { personId, phone, submissionId = null, audienceKind, sentBy } = req

  const db = supabaseAdmin()
  const tw = twilioConfig()
  // Returning the reason rather than failing silently: the review queue shows this
  // back to the officer, who would otherwise approve somebody and never learn that
  // no text left the building.
  if ('missing' in tw) return { error: NOT_CONFIGURED }

  const { data: settings } = await db.from('app_settings').select('key, value')
  const setting = (k: string, d: string) => settings?.find((r) => r.key === k)?.value ?? d

  const body = setting('sms_intro_text', '')
  if (!body) return { error: NO_INTRO_TEXT }

  const text = composeBody(body, {
    optOutText: setting('sms_optout_text', 'Text STOP to stop'),
  })

  const { data: message } = await db
    .from('messages')
    .insert({
      body,
      category: 'general',
      purpose: 'Intro text — opt-in form',
      audience_kind: audienceKind,
      audience_label:
        audienceKind === 'opt_in_review'
          ? 'Opt-in review — approved submission'
          : 'Opt-in form — automatic intro',
      // Consent is incomplete at this instant by definition: they have opted in and
      // this send is what supplies the other half.
      bypassed_consent_gate: true,
      sent_by: sentBy,
      status: 'sending',
      replies_monitored: false,
      segments: 1,
    })
    .select('id')
    .single()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  const statusCallback = siteUrl?.startsWith('https://')
    ? `${siteUrl}/api/twilio/status`
    : undefined

  const result = await sendOne(tw.config, phone, text, statusCallback)

  if (message) {
    await db.from('message_recipients').insert({
      message_id: message.id,
      person_id: personId,
      phone,
      twilio_sid: result.sid ?? null,
      status: result.error ? 'failed' : (result.status ?? 'queued'),
      delivery_status: result.status ?? null,
      error: result.error ?? null,
      error_code: result.errorCode ?? null,
      segments: result.segments ?? null,
      sent_at: result.error ? null : new Date().toISOString(),
    })

    await db
      .from('messages')
      .update({
        status: result.error ? 'failed' : 'sent',
        sent_at: new Date().toISOString(),
      })
      .eq('id', message.id)
  }

  // Only mark them introduced if Twilio accepted it. A failed send introduced
  // nobody, and marking it would quietly promote them into the regular audiences
  // having never heard from the club.
  if (!result.error) {
    await db
      .from('people')
      .update({ intro_sent_at: new Date().toISOString() })
      .eq('id', personId)
      .is('intro_sent_at', null)
  }

  if (submissionId) {
    await db
      .from('opt_in_submissions')
      .update({
        note: result.error
          ? `Intro text failed: ${result.error}`
          : 'Intro text sent',
      })
      .eq('id', submissionId)
  }

  return { error: result.error ?? null }
}

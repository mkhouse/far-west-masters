import 'server-only'

/**
 * Member consent states.
 *
 * The database stores five separate signals — phone, opt_in_at, intro_sent_at,
 * opted_out_at, sms_never — and whether someone can be texted is a combination of
 * all of them. Nobody should have to hold that in their head while looking at a
 * list, so it is reduced here to one state with one reason.
 *
 * Order matters: the checks run in the same sequence the consent gate applies, so a
 * person with no phone reports as unreachable rather than also as "no opt-in". A
 * single reason that is actually the blocking one is more useful than five true
 * facts.
 */

export type ConsentState =
  | 'eligible'
  | 'awaiting_intro'
  | 'not_opted_in'
  | 'opted_out'
  | 'suppressed'
  | 'no_phone'

export interface ConsentSignals {
  phone: string | null
  opt_in_at: string | null
  intro_sent_at: string | null
  opted_out_at: string | null
  sms_never: boolean
}

/** How each state reads on screen, and what it means. */
export const CONSENT_STATE_LABEL: Record<ConsentState, string> = {
  eligible: 'Can receive texts',
  awaiting_intro: 'Awaiting intro text',
  not_opted_in: 'Has not opted in',
  opted_out: 'Opted out',
  suppressed: 'Suppressed',
  no_phone: 'No phone number',
}

export const CONSENT_STATE_DETAIL: Record<ConsentState, string> = {
  eligible: 'Opted in and introduced — included in every ordinary audience.',
  awaiting_intro:
    'Opted in on the form but not yet sent the intro text that completes it. Included only in the intro audience.',
  not_opted_in: 'Has never submitted the opt-in form, so cannot be sent anything.',
  opted_out: 'Texted STOP. Twilio blocks further messages to this number.',
  suppressed: 'Manually suppressed by an officer, independent of anything the member did.',
  no_phone: 'No phone number on record, so there is nothing to send to.',
}

/** Reduce the five signals to the one that is actually blocking. */
export function consentState(p: ConsentSignals): ConsentState {
  if (!p.phone) return 'no_phone'
  if (p.opted_out_at) return 'opted_out'
  if (p.sms_never) return 'suppressed'
  if (!p.opt_in_at) return 'not_opted_in'
  if (!p.intro_sent_at) return 'awaiting_intro'
  return 'eligible'
}

/**
 * Format a phone number for reading, not for dialling.
 *
 * Stored as E.164 because that is what Twilio needs; +15305551234 is hard to read
 * and hard to check against a number someone reads out over the phone.
 */
export function formatPhone(phone: string | null): string {
  if (!phone) return '—'
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone
}

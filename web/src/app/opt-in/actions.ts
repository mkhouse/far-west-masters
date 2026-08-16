'use server'

/**
 * The public opt-in form's submit action.
 *
 * This is the only place in the system a stranger can write anything, so it is
 * written defensively:
 *
 *   * A submission is stored as a submission, never straight into `people`.
 *   * A text is only ever sent to a phone number that is ALREADY a member's. The
 *     form cannot be used to message an arbitrary number.
 *   * Nothing here trusts the browser beyond the five values it collected.
 *
 * On an exact phone match the member is linked, consent is recorded, and the intro
 * text goes out immediately — because the form promises "you will receive an
 * introductory SMS message shortly after you complete this form", and a promise
 * made to a member should not depend on an officer being at a screen.
 *
 * With no match, the submission waits for the review queue. Nothing is created and
 * nothing is sent: an unmatched submission is a question for a human.
 */

import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/phone'
import { sendIntro } from '@/lib/intro'
import { resolveEmail } from '@/lib/opt-in-review'

/** How recently the same number must have submitted to be treated as a repeat. */
const DUPLICATE_WINDOW_MINUTES = 10

export async function submitOptIn(formData: FormData) {
  // Honeypot. A field no human sees and every naive bot fills in. Chosen over a
  // CAPTCHA deliberately: the members most likely to be defeated by a CAPTCHA are
  // exactly the ones this form exists to reach.
  if (String(formData.get('website') ?? '')) {
    // Answer as though it worked. Telling a bot it was detected only teaches it.
    redirect('/opt-in?done=1')
  }

  const first = String(formData.get('first_name') ?? '').trim()
  const last = String(formData.get('last_name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const phoneRaw = String(formData.get('phone') ?? '').trim()
  const usssaRaw = String(formData.get('usssa') ?? '').trim()
  const consented = formData.get('consent') === 'on'

  const fail = (msg: string) =>
    redirect(`/opt-in?error=${encodeURIComponent(msg)}`)

  if (!first || !last) fail('Please give your first and last name.')
  if (!email.includes('@')) fail('Please give a valid email address.')
  if (!phoneRaw) fail('Please give a mobile number.')
  // The checkbox is the consent. Without it there is nothing to record.
  if (!consented) fail('Please tick the box to consent to SMS messaging.')

  const phone = toE164(phoneRaw)
  // The letter prefix on a USSA number is dropped, as everywhere else.
  const usssa = usssaRaw.replace(/[\s-]/g, '').replace(/^[A-Za-z]+/, '')

  const db = supabaseAdmin()

  // A repeat submission from the same number is almost always someone pressing the
  // button twice, and should not produce a second intro text.
  if (phone) {
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString()
    const { data: recent } = await db
      .from('opt_in_submissions')
      .select('id')
      .eq('phone', phone)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle()

    if (recent) redirect('/opt-in?done=1')
  }

  // Match on the normalised phone number, whatever the member's status — an
  // out-of-region racer or a lapsed member opting in is still that person.
  const { data: member } = phone
    ? await db
        .from('people')
        .select('id, first_name, last_name, email, opt_in_at, intro_sent_at, opted_out_at, sms_never, usssa')
        .eq('phone', phone)
        .maybeSingle()
    : { data: null }

  const { data: submission } = await db
    .from('opt_in_submissions')
    .insert({
      first_name: first,
      last_name: last,
      email,
      usssa: usssa ? Number(usssa) : null,
      phone_raw: phoneRaw,
      phone,
      consented,
      status: member ? 'linked' : 'pending',
      person_id: member?.id ?? null,
      linked_at: member ? new Date().toISOString() : null,
      match_method: member ? 'phone' : null,
    })
    .select('id')
    .single()

  if (!member) {
    // Held for review. Deliberately says nothing about whether they were
    // recognised — a public form should not report who is or is not a member.
    redirect('/opt-in?done=1')
  }

  // --- record consent ---
  //
  // opt_in_at is only set if it was not already: the first consent is the one that
  // matters, and its date is the one worth keeping. Re-submitting does not reset it.
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (!member.opt_in_at) updates.opt_in_at = new Date().toISOString()
  // Somebody who previously texted STOP and has now filled in the form has plainly
  // changed their mind. That is a clearer signal than the old opt-out.
  if (member.opted_out_at) updates.opted_out_at = null
  // Fill a missing USSA number from the form while we have it.
  if (!member.usssa && usssa) updates.usssa = Number(usssa)

  // The address they have just given us WINS over the one on file, even when we
  // already hold one (Melissa, 2026-08-16).
  //
  // Same principle as the phone number: a member typing into a form headed "register
  // your mobile number" is making a direct, current statement, and that beats a value
  // imported from AdminSkiRacing or carried over from Airtable years ago.
  //
  // Until now the form recorded the address in opt_in_submissions and never touched
  // the member record, so a member updating their email here was silently ignored —
  // and the membership import would then offer to "correct" it back to ASR's.
  //
  // No separate audit note: the submission row already holds what they gave and when.
  const decidedEmail = resolveEmail({ email: (member.email as string) ?? null }, { email })
  if (decidedEmail.email && decidedEmail.email !== member.email) {
    updates.email = decidedEmail.email
  }

  await db.from('people').update(updates).eq('id', member.id)

  // --- send the intro text ---
  //
  // Only when they have not had one. The intro is what completes consent, and
  // sending it twice to somebody re-submitting the form would be noise.
  if (!member.intro_sent_at && !member.sms_never) {
    await sendIntro({
      personId: member.id as string,
      phone: phone!,
      submissionId: (submission?.id as string) ?? null,
      audienceKind: 'opt_in_auto',
      // No officer sent it. Named rather than left blank, so the log does not imply
      // somebody did.
      sentBy: 'Opt-in form (automatic)',
    })
  }

  redirect('/opt-in?done=1')
}

'use server'

/**
 * Deciding what happens to an opt-in submission nobody could match.
 *
 * Three outcomes: link it to a member who turns out to exist, create a new person
 * from it, or reject it. All three record who decided and when.
 *
 * WHY A HUMAN DECIDES AT ALL. It would be tidier to create a person automatically on
 * any unmatched submission and send the intro straight away. That would also make the
 * public form into a way to make the club text an arbitrary number: type a name and
 * somebody else's mobile, and the system creates a record and texts them. The only
 * thing standing in the way today is a ten-minute per-number duplicate window, which
 * is not a defence. The review is the defence, and it costs little — Mary already
 * contacts every new member by hand.
 *
 * Every action re-reads the submission and re-matches before acting. The page that
 * called it may have been open for an hour, and the membership import may have
 * created the very person it says is missing.
 */

import { revalidatePath } from 'next/cache'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendIntro } from '@/lib/intro'
import { findMatch, getSubmission } from '@/lib/opt-in-review'
import { toE164 } from '@/lib/phone'

export interface ActionResult {
  ok: boolean
  error?: string
  /** Shown on success — says what happened, including whether a text went out. */
  message?: string
}

/** Everything a decision records about who made it. */
function reviewStamp(userId: string) {
  return { reviewed_at: new Date().toISOString(), reviewed_by: userId }
}

function refresh() {
  revalidatePath('/admin/opt-ins')
  revalidatePath('/admin')
  revalidatePath('/members')
}

/**
 * Attach the submission to a member who already exists.
 *
 * Used when the re-match found somebody — a member who typed a different number from
 * the one on file, or somebody the membership import created after they submitted.
 */
export async function linkSubmission(formData: FormData): Promise<ActionResult> {
  const officer = await requireAppUser()
  const id = String(formData.get('submission_id') ?? '')

  const sub = await getSubmission(id)
  if (!sub) return { ok: false, error: 'That submission has already been dealt with.' }

  // Re-match rather than trusting the id the page sent. If the page is stale, the
  // person it offered may not be the person the identifiers now point at, and
  // attaching consent to the wrong record is not a recoverable mistake.
  const found = await findMatch(sub)
  if (!found) {
    return {
      ok: false,
      error:
        'No member matches this submission any more. Reload the page — someone may have changed a phone number or email.',
    }
  }

  const person = found.person
  const db = supabaseAdmin()

  // --- record consent ---
  //
  // Dated to the submission, not to now. The member consented when they filled in
  // the form; the delay is ours, and back-dating an officer's convenience onto a
  // member's decision would make the record wrong.
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (!person.opt_in_at) updates.opt_in_at = sub.created_at
  // Somebody who previously texted STOP and has now filled in the form has plainly
  // changed their mind. That is a clearer signal than the old opt-out.
  if (person.opted_out_at) updates.opted_out_at = null
  if (!person.usssa && sub.usssa) updates.usssa = sub.usssa
  // Fill a missing phone number from the form, so the intro has somewhere to go.
  const phone = person.phone ?? sub.phone ?? toE164(sub.phone_raw)
  if (!person.phone && phone) updates.phone = phone

  await db.from('people').update(updates).eq('id', person.id)

  await db
    .from('opt_in_submissions')
    .update({
      status: 'linked',
      person_id: person.id,
      linked_at: new Date().toISOString(),
      linked_by: officer.userId,
      match_method: 'manual',
      ...reviewStamp(officer.userId),
    })
    .eq('id', id)

  const outcome = await introduce({
    person: { ...person, phone },
    submissionId: id,
    officer: officer.email ?? 'an officer',
  })

  refresh()
  return { ok: true, message: `Linked to ${person.first_name} ${person.last_name}. ${outcome}` }
}

/**
 * Create a new person from the submission.
 *
 * They are recorded as `sms_opt_in` — opted in for texts, not a member — which is
 * exactly what somebody who found the form and is not in the club is. If they later
 * join, the AdminSkiRacing membership import matches them on phone or email and their
 * status follows from that. Nothing here needs to guess at membership.
 */
export async function createFromSubmission(formData: FormData): Promise<ActionResult> {
  const officer = await requireAppUser()
  const id = String(formData.get('submission_id') ?? '')

  const sub = await getSubmission(id)
  if (!sub) return { ok: false, error: 'That submission has already been dealt with.' }

  // Re-match first. Creating a duplicate is the specific failure this whole module
  // exists to avoid, and the gap between the page rendering and this running is
  // exactly where the membership import lands.
  const found = await findMatch(sub)
  if (found) {
    return {
      ok: false,
      error: `${found.person.first_name} ${found.person.last_name} now matches this submission. Reload the page and link it instead of creating a duplicate.`,
    }
  }

  const phone = sub.phone ?? toE164(sub.phone_raw)
  if (!phone) {
    return {
      ok: false,
      error: `"${sub.phone_raw}" is not a usable mobile number, so there is nothing to text. Reject this one, or correct the number with the member first.`,
    }
  }

  const db = supabaseAdmin()

  // The USSA number is unique. Check for a clash so the message can name the person
  // — the constraint would catch it, but "23505" tells nobody anything, and the
  // usual cause is a typo on a public form.
  if (sub.usssa) {
    const { data: clash } = await db
      .from('people')
      .select('first_name, last_name')
      .eq('usssa', sub.usssa)
      .maybeSingle()

    if (clash) {
      return {
        ok: false,
        error: `USSA number ${sub.usssa} already belongs to ${clash.first_name} ${clash.last_name}. Check for a typo, or link this submission to them instead.`,
      }
    }
  }

  const { data: created, error } = await db
    .from('people')
    .insert({
      first_name: sub.first_name,
      last_name: sub.last_name,
      email: sub.email,
      phone,
      usssa: sub.usssa,
      status: 'sms_opt_in',
      // Dated to the submission: this is when they consented.
      opt_in_at: sub.created_at,
    })
    .select('id, first_name, last_name')
    .single()

  if (error || !created) {
    return { ok: false, error: error?.message ?? 'Could not create the person.' }
  }

  await db
    .from('opt_in_submissions')
    .update({
      status: 'linked',
      person_id: created.id,
      linked_at: new Date().toISOString(),
      linked_by: officer.userId,
      match_method: 'created',
      ...reviewStamp(officer.userId),
    })
    .eq('id', id)

  const outcome = await introduce({
    person: {
      id: created.id as string,
      phone,
      intro_sent_at: null,
      sms_never: false,
      first_name: created.first_name as string,
      last_name: created.last_name as string,
    },
    submissionId: id,
    officer: officer.email ?? 'an officer',
  })

  refresh()
  return {
    ok: true,
    message: `Added ${created.first_name} ${created.last_name} as opted-in for texts. ${outcome}`,
  }
}

/**
 * Reject a submission.
 *
 * Nothing is deleted. A rejection is part of the record of what was decided, and the
 * reason is required — six months on, "rejected" with no explanation is indistinguishable
 * from a mistake, and the same junk submission gets re-examined every time.
 */
export async function rejectSubmission(formData: FormData): Promise<ActionResult> {
  const officer = await requireAppUser()
  const id = String(formData.get('submission_id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()

  if (!reason) return { ok: false, error: 'Give a reason, so the decision makes sense later.' }

  const sub = await getSubmission(id)
  if (!sub) return { ok: false, error: 'That submission has already been dealt with.' }

  await supabaseAdmin()
    .from('opt_in_submissions')
    .update({
      status: 'rejected',
      note: reason,
      ...reviewStamp(officer.userId),
    })
    .eq('id', id)

  refresh()
  return { ok: true, message: 'Rejected. Nothing was created and no text was sent.' }
}

/**
 * Send the intro text, and describe what happened in words an officer can act on.
 *
 * Never throws: the link or the record has already been made by this point, and
 * losing that because Twilio was unreachable would be worse than reporting a text
 * that needs re-sending.
 */
async function introduce(opts: {
  person: {
    id: string
    phone: string | null
    intro_sent_at?: string | null
    sms_never?: boolean
    first_name: string
    last_name: string
  }
  submissionId: string
  officer: string
}): Promise<string> {
  const { person, submissionId, officer } = opts

  if (person.intro_sent_at) return 'They had already been sent an intro text.'
  if (person.sms_never) return 'No text sent — this person is suppressed.'
  if (!person.phone) return 'No text sent — no phone number on record.'

  try {
    const { error } = await sendIntro({
      personId: person.id,
      phone: person.phone,
      submissionId,
      audienceKind: 'opt_in_review',
      sentBy: officer,
    })

    return error
      ? `The intro text did not send: ${error} They are not yet in the regular audiences.`
      : 'Intro text sent.'
  } catch {
    return 'The intro text could not be sent. Their record is saved; try again from the members page.'
  }
}

import 'server-only'

/**
 * Reviewing opt-in submissions that the form could not match.
 *
 * The public form matches on phone number and, finding nobody, holds the submission
 * at 'pending'. That is the right call at submission time — creating a member record
 * from a public form is how a club ends up with fifteen duplicates — but it means
 * somebody has to look.
 *
 * THE IMPORTANT PROPERTY HERE IS THE RE-MATCH. A submission's stored verdict is a
 * fact about the moment it arrived, and it goes stale: a new member fills in the form
 * while registering with AdminSkiRacing, so they are genuinely not in `people` yet —
 * and then the membership import runs and creates them. Approving on the old verdict
 * would create a second record for somebody already there, splitting their consent
 * from their race results. So the queue matches again, live, every time it is read.
 *
 * The re-match is also wider than the form's. The form only has a phone number to go
 * on, because that is all it can trust at that moment. A reviewer can reasonably match
 * on email or USSA number too, and those catch the member who typed a different
 * number from the one on file.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/phone'

/** How a submission was matched to a member, in the order the matcher tries. */
export type MatchMethod = 'phone' | 'email' | 'usssa'

export interface MatchedPerson {
  id: string
  first_name: string
  last_name: string
  status: string
  phone: string | null
  email: string | null
  usssa: number | null
  opt_in_at: string | null
  intro_sent_at: string | null
  opted_out_at: string | null
  sms_never: boolean
}

export interface Submission {
  id: string
  created_at: string
  first_name: string
  last_name: string
  email: string
  usssa: number | null
  phone_raw: string
  phone: string | null
  consented: boolean
  note: string | null
}

export interface PendingSubmission extends Submission {
  /** A member this submission appears to be, found just now — not when it arrived. */
  match: MatchedPerson | null
  matchedBy: MatchMethod | null
  /**
   * What linking would do to the member's phone number.
   *
   * Computed here rather than in the card so the screen and the action apply the
   * same rule. A button that says one thing while the action does another is the
   * failure this whole module is arranged to avoid.
   */
  phoneChange: PhoneDecision | null
}

const PERSON_COLUMNS =
  'id, first_name, last_name, status, phone, email, usssa, opt_in_at, intro_sent_at, opted_out_at, sms_never'

const SUBMISSION_COLUMNS =
  'id, created_at, first_name, last_name, email, usssa, phone_raw, phone, consented, note'

/**
 * Find the member this submission is probably about.
 *
 * Order matters, and it is the order of how much the identifier is worth. A phone
 * number is what the club texts, so a match on it is the one that counts. An email
 * address is nearly as good. A USSA number is exact but is typed by hand on the form,
 * so it is tried last — a transposed digit there could otherwise attach somebody's
 * consent to a stranger's record.
 *
 * Returns null rather than guessing. An unmatched submission is a question for a
 * human, and this function's job is to answer it where it safely can, not to force
 * an answer.
 */
export async function findMatch(
  sub: Pick<Submission, 'phone' | 'phone_raw' | 'email' | 'usssa'>
): Promise<{ person: MatchedPerson; matchedBy: MatchMethod } | null> {
  const db = supabaseAdmin()

  // Normalise again rather than trusting the stored value: if toE164 has been fixed
  // since the submission arrived, a number that failed to normalise then may resolve
  // now, and that member should not stay lost because of an old bug.
  const phone = sub.phone ?? toE164(sub.phone_raw)

  if (phone) {
    const { data } = await db
      .from('people')
      .select(PERSON_COLUMNS)
      .eq('phone', phone)
      .maybeSingle()
    if (data) return { person: data as unknown as MatchedPerson, matchedBy: 'phone' }
  }

  const email = sub.email?.trim()
  if (email) {
    const { data } = await db
      .from('people')
      .select(PERSON_COLUMNS)
      .ilike('email', email)
      .limit(1)
      .maybeSingle()
    if (data) return { person: data as unknown as MatchedPerson, matchedBy: 'email' }
  }

  if (sub.usssa) {
    const { data } = await db
      .from('people')
      .select(PERSON_COLUMNS)
      .eq('usssa', sub.usssa)
      .maybeSingle()
    if (data) return { person: data as unknown as MatchedPerson, matchedBy: 'usssa' }
  }

  return null
}

/**
 * Everything waiting for a decision, oldest first.
 *
 * Oldest first because somebody who filled in the form three weeks ago has been
 * waiting longest, and a newest-first queue buries them under today's arrivals.
 */
export async function listPending(): Promise<PendingSubmission[]> {
  const db = supabaseAdmin()

  const { data } = await db
    .from('opt_in_submissions')
    .select(SUBMISSION_COLUMNS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  const submissions = (data ?? []) as unknown as Submission[]

  // Sequential rather than concurrent: this queue holds a handful of rows, and doing
  // three lookups each in parallel across all of them would hammer the database to
  // save milliseconds nobody would notice.
  const out: PendingSubmission[] = []
  for (const sub of submissions) {
    const found = await findMatch(sub)
    out.push({
      ...sub,
      match: found?.person ?? null,
      matchedBy: found?.matchedBy ?? null,
      phoneChange: found ? resolvePhone(found.person, sub) : null,
    })
  }

  return out
}

export interface PhoneDecision {
  /** The number to store and to send the intro to. Null only if there is none. */
  phone: string | null
  /** True when an existing number is being replaced, which is worth recording. */
  changed: boolean
  /** The number being replaced, for the record. Null unless `changed`. */
  from: string | null
}

/**
 * Which number wins when the form disagrees with the record.
 *
 * THE FORM WINS, and that is the point. The opt-in page asks members to "register
 * your mobile number" — somebody typing a different number from the one on file is
 * telling us where they want texts, and that statement is more recent and more
 * direct than anything imported from AdminSkiRacing or typed in years ago. It is the
 * same principle as the import rule: the member's own answer beats a synced one.
 *
 * There is a practical edge too. Twilio blocks opt-outs per NUMBER. Somebody who
 * texted STOP from an old handset and has now filled in the form with a new one can
 * only be reached on the new number — keeping the old one means the intro is refused
 * at the carrier and they never hear back.
 *
 * This can only arise in the review queue. The public form matches ON the phone
 * number, so there the two cannot disagree; matching on email or USSA is what makes
 * a mismatch possible.
 *
 * `keepExisting` is the officer's override, for when the new number is visibly a
 * typo. Without #59's member admin there is no other way to undo a bad overwrite, so
 * the escape hatch earns its place for now.
 */
export function resolvePhone(
  person: { phone: string | null },
  sub: { phone: string | null; phone_raw: string },
  keepExisting = false
): PhoneDecision {
  // Normalise again rather than trusting the stored value — same reasoning as
  // findMatch: a number that failed to normalise under an older version should not
  // stay unusable.
  const submitted = sub.phone ?? toE164(sub.phone_raw)

  // Nothing usable on the form: whatever is on file stands.
  if (!submitted) return { phone: person.phone, changed: false, from: null }

  // Filling a blank is not replacing anything, so it is not reported as a change.
  if (!person.phone) return { phone: submitted, changed: false, from: null }

  if (keepExisting || submitted === person.phone) {
    return { phone: person.phone, changed: false, from: null }
  }

  return { phone: submitted, changed: true, from: person.phone }
}

/** How many are waiting, for the badge on the admin index. */
export async function countPending(): Promise<number> {
  const { count } = await supabaseAdmin()
    .from('opt_in_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  return count ?? 0
}

/** One submission, for an action that needs to re-read it before acting. */
export async function getSubmission(id: string): Promise<Submission | null> {
  const { data } = await supabaseAdmin()
    .from('opt_in_submissions')
    .select(SUBMISSION_COLUMNS)
    .eq('id', id)
    .eq('status', 'pending')
    .maybeSingle()

  return (data as unknown as Submission) ?? null
}

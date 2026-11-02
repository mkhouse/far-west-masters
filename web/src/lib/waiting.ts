import 'server-only'

/**
 * Everyone who has consented and is waiting on the club.
 *
 * Three states with three different remedies, which until now lived on three
 * different screens — a review queue, a members-directory filter, and a second
 * filter beside it. Nothing added them up, so nobody was ever told how many people
 * were waiting in total.
 *
 * That is not an abstract tidiness problem. James Sanchirico opted in on 9 March
 * 2025 and his record sat in the "needs intro text" state for twenty months, because
 * the only thing that would have shown it was a filter somebody had to think to
 * apply. The count exists so that a number appears in the navigation when anybody is
 * waiting, and no number when nobody is.
 *
 * WHAT IS DELIBERATELY NOT HERE: people who have never opted in. There are over two
 * hundred of them and they are not waiting on anything — nobody has promised them a
 * message. Counting them would make this badge permanent, and a badge that is always
 * lit is one you stop seeing, which would cost exactly the attention this is for.
 */

import { supabaseAdmin } from './supabase/admin'
import { countPending } from './opt-in-review'
import { introFailures } from './intro-failures'

export interface WaitingPerson {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  /** When they consented — the clock that has been running. */
  optInAt: string
  /** Twilio's description, for someone whose intro was rejected. */
  failureReason?: string | null
}

export interface Waiting {
  /** Submissions the form could not match. Need a decision. */
  pendingReview: number
  /** Opted in, never sent an intro. Need a send. */
  awaitingIntro: WaitingPerson[]
  /** Intro attempted and permanently rejected. Need contacting another way. */
  introFailed: WaitingPerson[]
  /** What the badge shows. Zero means the badge is absent, not zero. */
  total: number
}

/** Consent columns, matching the audience module so the two cannot drift. */
const COLUMNS =
  'id, first_name, last_name, email, phone, opt_in_at, intro_sent_at, opted_out_at, sms_never'

interface Row {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  opt_in_at: string | null
  intro_sent_at: string | null
  opted_out_at: string | null
  sms_never: boolean
}

/**
 * Split the un-introduced into the two groups, which need different things.
 *
 * Pure, and exported for tests. The distinction is the one the RUNBOOK insists on:
 * somebody whose number never worked must NOT sit in the "send them an intro" pile,
 * because sending again does nothing — the number is the problem, and somebody has
 * to reach them by email or phone instead. Left mixed together they would be re-sent
 * to on every campaign, forever, and the count would never reach zero.
 */
export function splitUnintroduced(
  people: Array<{
    id: string
    first_name: string
    last_name: string
    email: string | null
    phone: string | null
    opt_in_at: string | null
    intro_sent_at: string | null
    opted_out_at: string | null
    sms_never: boolean
  }>,
  failures: Map<string, { error: string | null }>
): { awaitingIntro: WaitingPerson[]; introFailed: WaitingPerson[] } {
  const awaitingIntro: WaitingPerson[] = []
  const introFailed: WaitingPerson[] = []

  for (const p of people) {
    // Everything the consent gate would exclude for reasons other than the intro
    // itself. Somebody who opted out is not waiting on us; neither is somebody
    // suppressed, nor somebody with no number to send to.
    if (!p.opt_in_at) continue
    if (p.intro_sent_at) continue
    if (p.opted_out_at) continue
    if (p.sms_never) continue
    if (!p.phone) continue

    const person: WaitingPerson = {
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      email: p.email,
      phone: p.phone,
      optInAt: p.opt_in_at,
    }

    const failure = failures.get(p.id)
    if (failure) introFailed.push({ ...person, failureReason: failure.error })
    else awaitingIntro.push(person)
  }

  // Longest wait first, in both lists. The person who has been waiting since March
  // 2025 should not be below somebody who signed up this morning.
  const byOptIn = (a: WaitingPerson, b: WaitingPerson) =>
    a.optInAt.localeCompare(b.optInAt)

  return {
    awaitingIntro: awaitingIntro.sort(byOptIn),
    introFailed: introFailed.sort(byOptIn),
  }
}

/** Everyone waiting, with the counts the badge and the page both read. */
export async function waiting(): Promise<Waiting> {
  const [pendingReview, failures, { data }] = await Promise.all([
    countPending(),
    introFailures(),
    supabaseAdmin().from('people').select(COLUMNS).not('opt_in_at', 'is', null),
  ])

  const { awaitingIntro, introFailed } = splitUnintroduced(
    (data ?? []) as unknown as Row[],
    failures
  )

  return {
    pendingReview,
    awaitingIntro,
    introFailed,
    total: pendingReview + awaitingIntro.length + introFailed.length,
  }
}

/**
 * Just the number, for the header on every signed-in page.
 *
 * Separate from `waiting()` so the header does not carry the people it never
 * renders. It is still three queries on every page load; the alternative is a queue
 * nobody is told about, which is what this is for.
 */
export async function countWaiting(): Promise<number> {
  return (await waiting()).total
}

/** How long somebody has been waiting, for the page to say out loud. */
export function describeWait(optInAt: string, now = new Date()): string {
  const days = Math.floor(
    (now.getTime() - new Date(optInAt).getTime()) / 86_400_000
  )
  if (days < 1) return 'today'
  if (days === 1) return '1 day'
  if (days < 60) return `${days} days`

  // Past a couple of months the number of days stops meaning anything, and the
  // point being made is that this is embarrassing rather than precise.
  const months = Math.floor(days / 30)
  if (months < 24) return `${months} months`

  const years = Math.floor(months / 12)
  return years === 1 ? '1 year' : `${years} years`
}

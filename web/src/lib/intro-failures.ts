import 'server-only'

/**
 * People whose intro text was permanently rejected.
 *
 * WHY THIS IS DERIVED RATHER THAN STORED. The facts already exist: the message rows
 * say which sends were intros, and the recipient rows carry what the carrier said
 * about each one. A column on `people` would be a cached answer that has to be kept
 * in step with those, and the cost of it going stale is somebody being told to
 * re-send a text that cannot arrive.
 *
 * WHY IT MATTERS. `opt_in_at` set with `intro_sent_at` null describes two different
 * people who need opposite handling:
 *
 *   * nobody has sent them an intro yet — send one;
 *   * an intro was sent and the carrier refused it — sending again will fail again,
 *     because the number is a landline or is mistyped. What they need is somebody to
 *     get a working mobile number from them, which is a phone call or an email.
 *
 * Without the distinction a bad number sits in the intro audience forever, retried on
 * every campaign run, and the count never reaches zero.
 */

import { supabaseAdmin } from '@/lib/supabase/admin'
import { FAILED_DELIVERY_STATES, INTRO_AUDIENCE_KINDS } from '@/lib/delivery'

export interface IntroFailure {
  /** Twilio's code, e.g. 30006 for a landline. Null when it reported none. */
  errorCode: string | null
  /** Twilio's description, where it gave one. */
  error: string | null
  /** The number it was attempted on, which is the thing that needs correcting. */
  phone: string
}

/**
 * Everyone with a failed intro and no successful one since, by person id.
 *
 * One query rather than one per person: the directory renders three hundred rows and
 * would otherwise make three hundred round trips.
 */
export async function introFailures(): Promise<Map<string, IntroFailure>> {
  const { data } = await supabaseAdmin()
    .from('message_recipients')
    .select('person_id, phone, error, error_code, delivery_status, messages!inner(audience_kind)')
    .in('delivery_status', [...FAILED_DELIVERY_STATES])
    .in('messages.audience_kind', INTRO_AUDIENCE_KINDS)

  const rows = (data ?? []) as unknown as Array<{
    person_id: string | null
    phone: string
    error: string | null
    error_code: string | null
  }>

  const failures = new Map<string, IntroFailure>()
  for (const r of rows) {
    if (!r.person_id) continue
    // Last one wins where somebody has several: the most recent attempt is the one
    // describing the number currently on file.
    failures.set(r.person_id, {
      errorCode: r.error_code,
      error: r.error,
      phone: r.phone,
    })
  }

  return failures
}

/**
 * Attach the flag to a list of people.
 *
 * A helper rather than a pattern to remember, because forgetting it does not fail —
 * it silently reports everybody as merely awaiting an intro, which is the bug this
 * module exists to prevent.
 *
 * Note the guard: somebody who HAS been introduced since is not marked, however many
 * failures they have behind them. A member who moved from a landline to a mobile has
 * a failed attempt on record and is perfectly reachable now.
 */
export function withIntroFailures<T extends { id: string; intro_sent_at: string | null }>(
  people: T[],
  failures: Map<string, IntroFailure>
): Array<T & { intro_failed: boolean }> {
  return people.map((p) => ({
    ...p,
    intro_failed: !p.intro_sent_at && failures.has(p.id),
  }))
}

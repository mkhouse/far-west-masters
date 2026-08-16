/**
 * What Twilio's delivery states mean.
 *
 * Kept in one place because two things now depend on the answer, and they must not
 * drift: the message detail page colours a recipient red, and the status webhook
 * decides whether an intro text needs sending again. A page that calls something a
 * failure while the webhook does not would leave people stranded in exactly the way
 * this module exists to prevent.
 *
 * Pure, and deliberately not marked `server-only` — see lib/format.ts for the same
 * reasoning. Nothing here reads a key, a request or the database.
 */

/**
 * States meaning the message will not arrive, ever.
 *
 * Twilio's lifecycle is queued → sent → delivered, with `failed` and `undelivered`
 * as the terminal failures. Everything else is genuinely still in progress and must
 * not be treated as either outcome — a hopeful "delivered" on `sent` would claim
 * something nobody knows yet, and a pessimistic failure would re-send needlessly.
 */
export const FAILED_DELIVERY_STATES = ['failed', 'undelivered'] as const

/** Did this message definitively not arrive? */
export function isPermanentFailure(status: string | null | undefined): boolean {
  return FAILED_DELIVERY_STATES.includes(status as (typeof FAILED_DELIVERY_STATES)[number])
}

/**
 * The audiences whose messages are intro texts.
 *
 * An intro is the message that completes somebody's consent, so a failed one has a
 * consequence no other failure has: the person is left marked as introduced without
 * ever having heard from the club. These are the sends the status webhook has to
 * treat specially.
 *
 * `opt_in_auto` is the public form sending on a phone match; `opt_in_review` is an
 * officer approving a submission in the queue. `series_intro` is retained because
 * historical messages still carry it — the audience was renamed in task #48, and a
 * delivery report can arrive for a message sent before that.
 */
export const INTRO_AUDIENCE_KINDS = ['opt_in_auto', 'opt_in_review', 'series_intro']

/** Is this message an intro text, whose failure should be undone? */
export function isIntroAudience(kind: string | null | undefined): boolean {
  return !!kind && INTRO_AUDIENCE_KINDS.includes(kind)
}

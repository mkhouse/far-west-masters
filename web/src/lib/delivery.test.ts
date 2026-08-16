/**
 * Delivery states, and which failures have to be undone.
 *
 * Found by testing on 2026-08-16 and worth stating plainly: `intro_sent_at` is
 * stamped when Twilio ACCEPTS an intro text, because that is the only answer
 * available at send time. A message Twilio accepted and the carrier then rejected —
 * error 30006, a landline — left the person marked as introduced, sitting in every
 * ordinary audience, having never heard from the club. Nothing anywhere said so.
 *
 * These two predicates are what the status webhook uses to undo that. Getting either
 * wrong has a direction:
 *
 *   Too broad  — an ordinary message bouncing un-introduces somebody, dropping them
 *                out of every audience for a reason unrelated to their consent.
 *   Too narrow — the original bug returns, silently.
 */

import { describe, expect, it } from 'vitest'
import {
  FAILED_DELIVERY_STATES,
  INTRO_AUDIENCE_KINDS,
  isIntroAudience,
  isPermanentFailure,
} from './delivery'

describe('isPermanentFailure', () => {
  it.each(['failed', 'undelivered'])('treats %s as final', (state) => {
    expect(isPermanentFailure(state)).toBe(true)
  })

  // Everything here is still in progress. Treating any of them as failure would
  // re-send an intro to somebody whose first one is about to arrive.
  it.each(['queued', 'accepted', 'sending', 'sent', 'delivered', 'read', 'receiving'])(
    'does not treat %s as final',
    (state) => {
      expect(isPermanentFailure(state)).toBe(false)
    }
  )

  it('treats an absent status as not final', () => {
    expect(isPermanentFailure(null)).toBe(false)
    expect(isPermanentFailure(undefined)).toBe(false)
    expect(isPermanentFailure('')).toBe(false)
  })

  it('does not treat an unrecognised status as final', () => {
    // A state Twilio adds later must not silently start un-introducing people.
    expect(isPermanentFailure('some_future_state')).toBe(false)
  })
})

describe('isIntroAudience', () => {
  it('recognises the intro sent automatically by the public form', () => {
    expect(isIntroAudience('opt_in_auto')).toBe(true)
  })

  it('recognises the intro sent from the review queue', () => {
    expect(isIntroAudience('opt_in_review')).toBe(true)
  })

  // Renamed in task #48. A delivery report can still arrive for a message sent
  // before that, and it is the same kind of send.
  it('still recognises the historical intro audience', () => {
    expect(isIntroAudience('series_intro')).toBe(true)
  })

  // The important half. A race announcement failing means that number is bad today;
  // it does not mean the person was never introduced, and un-introducing them over
  // it would remove them from every audience.
  it.each(['group', 'all_eligible', 'series', 'intro_pending', 'always', 'filtered'])(
    'does not treat %s as an intro',
    (kind) => {
      expect(isIntroAudience(kind)).toBe(false)
    }
  )

  it('treats an absent audience as not an intro', () => {
    expect(isIntroAudience(null)).toBe(false)
    expect(isIntroAudience(undefined)).toBe(false)
    expect(isIntroAudience('')).toBe(false)
  })
})

describe('the two lists stay honest', () => {
  it('lists exactly the two terminal Twilio states', () => {
    expect([...FAILED_DELIVERY_STATES]).toEqual(['failed', 'undelivered'])
  })

  it('does not include intro_pending among the intro audiences', () => {
    // Easy to confuse: intro_pending is the audience you SEND to, not the kind
    // recorded on a message that was sent. Including it here would be harmless
    // today and wrong the moment anything sends with that kind recorded.
    expect(INTRO_AUDIENCE_KINDS).not.toContain('intro_pending')
  })
})

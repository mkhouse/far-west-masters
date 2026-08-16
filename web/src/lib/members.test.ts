/**
 * Member consent states.
 *
 * `consentState` reduces five database columns to the one fact that matters: can
 * this person be texted, and if not, why not. It decides what the directory shows,
 * which filters exist, and — through MESSAGEABLE — whether a send button appears at
 * all. It must agree with the consent gate in audiences.ts, and the last test here
 * is what holds the two together.
 */

import { describe, expect, it } from 'vitest'
import {
  CONSENT_STATE_LABEL,
  MESSAGEABLE,
  consentState,
  type ConsentSignals,
} from './members'

/** Somebody who has cleared every part of the gate. */
function signals(over: Partial<ConsentSignals> = {}): ConsentSignals {
  return {
    phone: '+15305551234',
    opt_in_at: '2026-01-01T00:00:00Z',
    intro_sent_at: '2026-01-02T00:00:00Z',
    opted_out_at: null,
    sms_never: false,
    ...over,
  }
}

describe('consentState', () => {
  it('reports eligible only when every signal is clear', () => {
    expect(consentState(signals())).toBe('eligible')
  })

  it.each([
    [{ phone: null }, 'no_phone'],
    [{ opted_out_at: '2026-02-01T00:00:00Z' }, 'opted_out'],
    [{ sms_never: true }, 'suppressed'],
    [{ opt_in_at: null }, 'not_opted_in'],
    [{ intro_sent_at: null }, 'awaiting_intro'],
  ] as const)('reports %o as %s', (override, expected) => {
    expect(consentState(signals(override))).toBe(expected)
  })

  // The order is the point: one blocking reason, and it should be the one a human
  // would act on first. Telling somebody a member "has not opted in" when the real
  // problem is that we hold no phone number sends them to fix the wrong thing.
  describe('reports the first blocking reason, not all of them', () => {
    it('puts a missing phone number ahead of everything else', () => {
      expect(
        consentState(
          signals({
            phone: null,
            opt_in_at: null,
            sms_never: true,
            opted_out_at: '2026-02-01T00:00:00Z',
          })
        )
      ).toBe('no_phone')
    })

    it('puts an explicit opt-out ahead of suppression and missing consent', () => {
      expect(
        consentState(
          signals({ opted_out_at: '2026-02-01T00:00:00Z', sms_never: true, opt_in_at: null })
        )
      ).toBe('opted_out')
    })

    it('puts suppression ahead of missing consent', () => {
      expect(consentState(signals({ sms_never: true, opt_in_at: null }))).toBe('suppressed')
    })

    it('puts missing consent ahead of a missing intro text', () => {
      expect(consentState(signals({ opt_in_at: null, intro_sent_at: null }))).toBe(
        'not_opted_in'
      )
    })
  })
})

// A failed intro and an unsent one are identical in the database — opt_in_at set,
// intro_sent_at null — and call for opposite actions. One needs a text sending; the
// other will reject every text until somebody gets a working number from them.
describe('a permanently failed intro is its own state', () => {
  it('reports intro_failed rather than awaiting_intro', () => {
    expect(
      consentState(signals({ intro_sent_at: null, intro_failed: true }))
    ).toBe('intro_failed')
  })

  it('still reports awaiting_intro when nothing has failed', () => {
    expect(consentState(signals({ intro_sent_at: null }))).toBe('awaiting_intro')
    expect(
      consentState(signals({ intro_sent_at: null, intro_failed: false }))
    ).toBe('awaiting_intro')
  })

  // Somebody who moved from a landline to a mobile has a failure behind them and is
  // perfectly reachable now. The successful intro is what counts.
  it('reports eligible once an intro has actually been sent', () => {
    expect(consentState(signals({ intro_failed: true }))).toBe('eligible')
  })

  // The blocking reason still has to be the one a human would act on first.
  it('puts not opted in, opted out and suppression ahead of it', () => {
    expect(consentState(signals({ opt_in_at: null, intro_sent_at: null, intro_failed: true })))
      .toBe('not_opted_in')
    expect(
      consentState(
        signals({ intro_sent_at: null, intro_failed: true, opted_out_at: '2026-02-01T00:00:00Z' })
      )
    ).toBe('opted_out')
    expect(
      consentState(signals({ intro_sent_at: null, intro_failed: true, sms_never: true }))
    ).toBe('suppressed')
  })
})

describe('MESSAGEABLE', () => {
  // The absence of a send button IS the rule for every other state. If a state ever
  // gains an entry here, somebody has made a way to message people who did not agree.
  it('offers a send action for exactly two states, both already opted in', () => {
    expect(Object.keys(MESSAGEABLE).sort()).toEqual(['awaiting_intro', 'eligible'])
  })

  it('routes each to the audience that computes the same set', () => {
    expect(MESSAGEABLE.eligible?.audience).toBe('all_eligible')
    expect(MESSAGEABLE.awaiting_intro?.audience).toBe('intro_pending')
  })

  it('offers nothing for anyone who has not opted in', () => {
    for (const state of [
      'not_opted_in',
      'opted_out',
      'suppressed',
      'no_phone',
      // Deliberately here rather than among the messageable states: sending again
      // to a number the carrier refused cannot work.
      'intro_failed',
    ] as const) {
      expect(MESSAGEABLE[state], `${state} must have no send action`).toBeUndefined()
    }
  })
})

describe('CONSENT_STATE_LABEL', () => {
  it('has wording for every state', () => {
    for (const state of [
      'eligible',
      'awaiting_intro',
      'intro_failed',
      'not_opted_in',
      'opted_out',
      'suppressed',
      'no_phone',
    ] as const) {
      expect(CONSENT_STATE_LABEL[state]).toBeTruthy()
    }
  })
})

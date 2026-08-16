/**
 * Marking people whose intro text was permanently rejected.
 *
 * `withIntroFailures` is the pure half — the query it depends on is asserted in
 * audiences.test.ts, where the predicates are recorded.
 *
 * The guard being tested here is easy to leave out and impossible to notice: without
 * it, anyone with an old failure behind them is flagged forever, including members
 * who moved from a landline to a mobile and are perfectly reachable now.
 */

import { describe, expect, it } from 'vitest'
import { withIntroFailures, type IntroFailure } from './intro-failures'

const failure: IntroFailure = {
  errorCode: '30006',
  error: 'Landline or unreachable carrier',
  phone: '+15305550100',
}

const failures = new Map([['stranded', failure]])

describe('withIntroFailures', () => {
  it('flags somebody whose intro failed and who has had none since', () => {
    const [p] = withIntroFailures([{ id: 'stranded', intro_sent_at: null }], failures)
    expect(p.intro_failed).toBe(true)
  })

  it('does not flag somebody with no failure on record', () => {
    const [p] = withIntroFailures([{ id: 'fine', intro_sent_at: null }], failures)
    expect(p.intro_failed).toBe(false)
  })

  // The guard. A member who has since been introduced successfully is reachable,
  // however many failed attempts sit behind them.
  it('does not flag somebody who has since been introduced', () => {
    const [p] = withIntroFailures(
      [{ id: 'stranded', intro_sent_at: '2026-02-01T00:00:00Z' }],
      failures
    )
    expect(p.intro_failed).toBe(false)
  })

  it('leaves every other field alone', () => {
    const person = { id: 'stranded', intro_sent_at: null, first_name: 'Ada' }
    const [p] = withIntroFailures([person], failures)
    expect(p.first_name).toBe('Ada')
    expect(p.id).toBe('stranded')
  })

  it('flags nobody when there are no failures at all', () => {
    const people = [
      { id: 'a', intro_sent_at: null },
      { id: 'b', intro_sent_at: null },
    ]
    for (const p of withIntroFailures(people, new Map())) {
      expect(p.intro_failed).toBe(false)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { describeWait, splitUnintroduced } from './waiting'

/**
 * The grouping decides what an officer is told to DO about somebody, and the two
 * answers are not interchangeable: one is "send them a text", the other is "a text
 * will never reach them, use their email". Getting it wrong means re-sending to a
 * dead number on every campaign while the person goes on hearing nothing.
 */
const person = (over: Partial<Parameters<typeof splitUnintroduced>[0][number]> = {}) => ({
  id: crypto.randomUUID(),
  first_name: 'Test',
  last_name: 'Member',
  email: 'test@example.com',
  phone: '+15305551234',
  opt_in_at: '2026-01-01T00:00:00Z',
  intro_sent_at: null,
  opted_out_at: null,
  sms_never: false,
  ...over,
})

const noFailures = new Map<string, { error: string | null }>()

describe('splitUnintroduced', () => {
  it('lists somebody who opted in and never got an intro', () => {
    const { awaitingIntro, introFailed } = splitUnintroduced([person()], noFailures)
    expect(awaitingIntro).toHaveLength(1)
    expect(introFailed).toEqual([])
  })

  it('separates somebody whose intro was permanently rejected', () => {
    // The distinction that matters. Sending again achieves nothing — the number is
    // the problem, and somebody has to reach them another way.
    const bad = person()
    const failures = new Map([[bad.id, { error: 'Landline or unreachable carrier' }]])

    const { awaitingIntro, introFailed } = splitUnintroduced([bad], failures)
    expect(awaitingIntro).toEqual([])
    expect(introFailed).toHaveLength(1)
    expect(introFailed[0].failureReason).toBe('Landline or unreachable carrier')
  })

  it('counts nobody twice', () => {
    const bad = person()
    const good = person()
    const failures = new Map([[bad.id, { error: null }]])

    const { awaitingIntro, introFailed } = splitUnintroduced([bad, good], failures)
    expect(awaitingIntro.length + introFailed.length).toBe(2)
    expect(awaitingIntro[0].id).toBe(good.id)
    expect(introFailed[0].id).toBe(bad.id)
  })

  it.each([
    ['has already been introduced', { intro_sent_at: '2026-02-01T00:00:00Z' }],
    ['never opted in', { opt_in_at: null }],
    ['has opted out', { opted_out_at: '2026-02-01T00:00:00Z' }],
    ['is suppressed', { sms_never: true }],
    ['has no phone number', { phone: null }],
  ])('does not list somebody who %s', (_label, over) => {
    const { awaitingIntro, introFailed } = splitUnintroduced([person(over)], noFailures)
    expect(awaitingIntro).toEqual([])
    expect(introFailed).toEqual([])
  })

  it('puts the longest wait first', () => {
    // The person waiting since March 2025 must not sit below somebody who signed up
    // this morning — the ordering is the whole argument the page is making.
    const { awaitingIntro } = splitUnintroduced(
      [
        person({ opt_in_at: '2026-10-01T00:00:00Z', first_name: 'Recent' }),
        person({ opt_in_at: '2025-03-09T00:00:00Z', first_name: 'Oldest' }),
        person({ opt_in_at: '2026-02-13T00:00:00Z', first_name: 'Middle' }),
      ],
      noFailures
    )
    expect(awaitingIntro.map((p) => p.firstName)).toEqual([
      'Oldest',
      'Middle',
      'Recent',
    ])
  })

  it('ignores a failure belonging to somebody who has since been introduced', () => {
    // A member who moved from a landline to a mobile has a failed attempt on record
    // and is perfectly reachable now. The intro_sent_at check runs first.
    const recovered = person({ intro_sent_at: '2026-03-01T00:00:00Z' })
    const failures = new Map([[recovered.id, { error: 'Landline' }]])

    const { awaitingIntro, introFailed } = splitUnintroduced([recovered], failures)
    expect(awaitingIntro).toEqual([])
    expect(introFailed).toEqual([])
  })

  it('returns nothing for nobody', () => {
    expect(splitUnintroduced([], noFailures)).toEqual({
      awaitingIntro: [],
      introFailed: [],
    })
  })
})

describe('describeWait', () => {
  const now = new Date('2026-11-02T12:00:00Z')

  it('reads naturally across the ranges', () => {
    expect(describeWait('2026-11-02T09:00:00Z', now)).toBe('today')
    expect(describeWait('2026-11-01T09:00:00Z', now)).toBe('1 day')
    expect(describeWait('2026-10-20T12:00:00Z', now)).toBe('13 days')
    expect(describeWait('2026-02-13T12:00:00Z', now)).toBe('8 months')
  })

  it('still reads in months at twenty', () => {
    // James Sanchirico, 9 March 2025 — about 603 days, which is 20 months. The
    // point being made is that this is embarrassing, not that it is 603 days.
    expect(describeWait('2025-03-09T12:00:00Z', now)).toBe('20 months')
  })

  it('switches to years, and says "1 year" rather than "1 years"', () => {
    expect(describeWait('2024-09-01T12:00:00Z', now)).toBe('2 years')
    expect(describeWait('2024-10-20T12:00:00Z', now)).toBe('2 years')
  })
})

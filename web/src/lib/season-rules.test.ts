import { describe, expect, it } from 'vitest'
import { bestNDrifted, bestNFor } from './season-rules'

describe('bestNFor — 75% of the counting races, rounded up', () => {
  it('reproduces the two seasons the club has published', () => {
    // 2026-2027: "best 13 finishes of 17 races are counted".
    expect(bestNFor(17)).toBe(13)
    // 2025-2026, already verified in the database: 14 races, best 11.
    expect(bestNFor(14)).toBe(11)
  })

  it('rounds up rather than to nearest', () => {
    // 0.75 x 14 is exactly 10.5 and the answer is 11, not 10.
    expect(bestNFor(14)).toBe(11)
    expect(bestNFor(13)).toBe(10) // 9.75
    expect(bestNFor(12)).toBe(9) // exactly 9
  })

  it('would give the wrong answer from the raw race count', () => {
    // The trap this exists to avoid: 21 rows in the 2026-2027 schedule, four of
    // them not Far West division races.
    expect(bestNFor(21)).toBe(16)
    expect(bestNFor(17)).toBe(13)
  })

  it('is zero before there is a schedule', () => {
    expect(bestNFor(0)).toBe(0)
    expect(bestNFor(-1)).toBe(0)
  })
})

describe('bestNDrifted — races get added mid-season', () => {
  it('is false while the stored value still matches', () => {
    expect(bestNDrifted(13, 17)).toBe(false)
  })

  it('is true once a race is added', () => {
    // The rules allow races "added to the schedule during the season"; a
    // best-13 over 18 counting races is wrong, and quietly so.
    expect(bestNDrifted(13, 18)).toBe(true)
    expect(bestNFor(18)).toBe(14)
  })

  it('says nothing before the rules are set or the schedule imported', () => {
    expect(bestNDrifted(0, 17)).toBe(false)
    expect(bestNDrifted(13, 0)).toBe(false)
  })
})

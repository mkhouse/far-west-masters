/**
 * The membership year and the racing season.
 *
 * Both are easy to get subtly wrong in ways nobody notices until a specific week of
 * the year, which is the worst kind of bug in a system used seasonally. The season
 * window in particular wraps the new year — 15 October to 1 April — so a naive
 * "between start and end" comparison is false for the whole of the season.
 */

import { describe, expect, it } from 'vitest'
import { daysSince, isInSeason, seasonFor } from './season'

const on = (iso: string) => new Date(`${iso}T12:00:00`)

describe('seasonFor', () => {
  // Membership lapses on 1 September, so that is where the label turns over.
  it('rolls over on 1 September', () => {
    expect(seasonFor(on('2026-08-31'))).toBe('2025-2026')
    expect(seasonFor(on('2026-09-01'))).toBe('2026-2027')
  })

  it('keeps the same label across the new year', () => {
    // A race in December and one in March belong to the same membership year.
    expect(seasonFor(on('2026-12-25'))).toBe('2026-2027')
    expect(seasonFor(on('2027-03-15'))).toBe('2026-2027')
  })

  it('uses the club’s own format', () => {
    // "2025-2026", not "2025-26" or "2026". Melissa, 2026-08-16.
    expect(seasonFor(on('2026-01-15'))).toBe('2025-2026')
  })

  it('covers a full year with no gap and no overlap', () => {
    // Every day from one turnover to the day before the next reports one label.
    expect(seasonFor(on('2026-09-01'))).toBe('2026-2027')
    expect(seasonFor(on('2027-08-31'))).toBe('2026-2027')
    expect(seasonFor(on('2027-09-01'))).toBe('2027-2028')
  })

  it('respects a different turnover date', () => {
    expect(seasonFor(on('2026-07-01'), '07-01')).toBe('2026-2027')
    expect(seasonFor(on('2026-06-30'), '07-01')).toBe('2025-2026')
  })
})

describe('isInSeason', () => {
  it('is running through the winter', () => {
    for (const day of ['2026-10-15', '2026-11-01', '2026-12-25', '2027-01-10', '2027-03-31', '2027-04-01']) {
      expect(isInSeason(on(day)), day).toBe(true)
    }
  })

  it('is not running through the summer', () => {
    for (const day of ['2026-04-02', '2026-06-01', '2026-08-16', '2026-10-14']) {
      expect(isInSeason(on(day)), day).toBe(false)
    }
  })

  // The boundary that matters most: renewals open around 15 October, so the warning
  // starts then and not before, when there is genuinely nothing to import.
  it('starts on 15 October, not before', () => {
    expect(isInSeason(on('2026-10-14'))).toBe(false)
    expect(isInSeason(on('2026-10-15'))).toBe(true)
  })

  it('ends on 1 April, inclusive', () => {
    expect(isInSeason(on('2027-04-01'))).toBe(true)
    expect(isInSeason(on('2027-04-02'))).toBe(false)
  })

  // Written as a wrap-around on purpose. A window that does not cross the new year
  // should still behave, in case anyone reconfigures it.
  it('handles a window that does not wrap', () => {
    expect(isInSeason(on('2026-05-15'), '05-01', '06-01')).toBe(true)
    expect(isInSeason(on('2026-04-15'), '05-01', '06-01')).toBe(false)
    expect(isInSeason(on('2026-06-15'), '05-01', '06-01')).toBe(false)
  })
})

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince(on('2026-12-01'), on('2026-12-15'))).toBe(14)
  })

  // Truncated, not rounded: thirteen and a half days must not trip a fourteen-day
  // threshold a day early.
  it('truncates rather than rounding up', () => {
    const then = new Date('2026-12-01T00:00:00')
    const now = new Date('2026-12-14T23:00:00')
    expect(daysSince(then, now)).toBe(13)
  })

  it('reports zero for something that just happened', () => {
    expect(daysSince(on('2026-12-01'), on('2026-12-01'))).toBe(0)
  })
})

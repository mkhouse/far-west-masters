import { describe, expect, it } from 'vitest'
import { formatRaceDate, raceLabel } from './races'

/**
 * The date handling only. `upcomingRaces` talks to Supabase and belongs in the
 * integration tests the runner config describes as tier 2.
 *
 * These are worth having on their own because the bug they guard against is
 * seasonal: it is invisible in summer on a UTC machine and wrong every race day.
 */
describe('formatRaceDate', () => {
  it('formats a race date with its weekday', () => {
    expect(formatRaceDate('2027-03-06')).toBe('Sat 6 Mar')
  })

  it('does not shift the day west of UTC', () => {
    // THE TRAP. A `date` column has no time, so `new Date('2027-02-14')` parses as
    // UTC midnight — which in Pacific time is 4pm on the 13th. Formatted naively,
    // every race in the picker would be listed a day early, all season, for everyone
    // actually using this. Built from the string parts instead, so the machine's
    // timezone cannot reach it.
    const previous = process.env.TZ
    try {
      process.env.TZ = 'America/Los_Angeles'
      expect(formatRaceDate('2027-02-14')).toBe('Sun 14 Feb')
      process.env.TZ = 'Pacific/Kiritimati' // UTC+14, the other direction
      expect(formatRaceDate('2027-02-14')).toBe('Sun 14 Feb')
    } finally {
      process.env.TZ = previous
    }
  })

  it('handles the turn of the year', () => {
    expect(formatRaceDate('2027-01-01')).toBe('Fri 1 Jan')
    expect(formatRaceDate('2026-12-31')).toBe('Thu 31 Dec')
  })

  it('shows an unparseable value rather than hiding it', () => {
    // Same principle as formatPhone: something in an odd shape is exactly what
    // somebody needs to see in order to fix it.
    expect(formatRaceDate('not a date')).toBe('not a date')
  })
})

describe('raceLabel', () => {
  it('reads as a resort and a date, which is how an officer thinks about a race', () => {
    expect(
      raceLabel({
        id: 'r1',
        venue: 'Palisades Tahoe',
        name: 'Bernard Cup GS - March 07, 2027 (1 of 2)',
        date: '2027-03-07',
        series: 'Bernard Cup',
      })
    ).toBe('Palisades Tahoe — Sun 7 Mar')
  })
})

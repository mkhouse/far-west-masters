/**
 * Which season is shown, and when to say the data is old.
 *
 * The pure half of lib/membership.ts. Both decisions are seasonal, which means a
 * mistake is invisible for most of the year and then wrong for a specific fortnight
 * — the worst shape of bug in a system used a few months a year.
 */

import { describe, expect, it } from 'vitest'
import { assessFreshness, displaySeason, type SeasonSettings } from './membership'

const settings: SeasonSettings = {
  membershipYearStart: '09-01',
  seasonStart: '10-15',
  seasonEnd: '04-01',
  maxImportAgeDays: 14,
}

const on = (iso: string) => new Date(`${iso}T12:00:00`)
const daysBefore = (date: Date, n: number) =>
  new Date(date.getTime() - n * 86_400_000).toISOString()

describe('displaySeason', () => {
  it('shows the current season once it has an import', () => {
    const d = displaySeason('2026-2027', ['2025-2026', '2026-2027'])
    expect(d.season).toBe('2026-2027')
    expect(d.isFallback).toBe(false)
  })

  // From 1 September nobody holds a membership for the new season until the first
  // import, which would leave the directory apparently empty for six weeks or more.
  it('falls back to the most recent imported season, and says so', () => {
    const d = displaySeason('2026-2027', ['2024-2025', '2025-2026'])
    expect(d.season).toBe('2025-2026')
    expect(d.currentSeason).toBe('2026-2027')
    expect(d.isFallback).toBe(true)
  })

  it('shows the current season when nothing has ever been imported', () => {
    // Nothing to fall back to, and nothing to explain — it is simply empty.
    const d = displaySeason('2026-2027', [])
    expect(d.season).toBe('2026-2027')
    expect(d.isFallback).toBe(false)
  })

  it('picks the latest fallback, not merely the first it finds', () => {
    const d = displaySeason('2027-2028', ['2025-2026', '2023-2024', '2026-2027'])
    expect(d.season).toBe('2026-2027')
  })

  it('never reports a fallback when it is showing the current season', () => {
    for (const seasons of [['2026-2027'], ['2026-2027', '2025-2026']]) {
      expect(displaySeason('2026-2027', seasons).isFallback).toBe(false)
    }
  })
})

describe('assessFreshness', () => {
  const current = displaySeason('2026-2027', ['2026-2027'])

  it('says nothing out of season', () => {
    // Nobody joins in July, and a warning nobody needs is one people learn to ignore.
    const summer = on('2026-07-15')
    const f = assessFreshness(summer, settings, current, daysBefore(summer, 200))
    expect(f.stale).toBe(false)
  })

  it('says nothing about a recent import in season', () => {
    const winter = on('2027-01-15')
    const f = assessFreshness(winter, settings, current, daysBefore(winter, 3))
    expect(f.stale).toBe(false)
    expect(f.daysOld).toBe(3)
  })

  it('warns once the import is older than the threshold', () => {
    const winter = on('2027-01-15')
    expect(assessFreshness(winter, settings, current, daysBefore(winter, 14)).stale).toBe(false)
    expect(assessFreshness(winter, settings, current, daysBefore(winter, 15)).stale).toBe(true)
  })

  // The most important case, not the least: it is what happens when the first import
  // of the year is forgotten entirely.
  it('warns in season when nothing has been imported at all', () => {
    const f = assessFreshness(on('2026-11-01'), settings, current, null)
    expect(f.stale).toBe(true)
    expect(f.daysOld).toBeNull()
  })

  it('warns in season while falling back to an older year', () => {
    const fallback = displaySeason('2026-2027', ['2025-2026'])
    const winter = on('2026-11-01')
    const f = assessFreshness(winter, settings, fallback, daysBefore(winter, 1))
    // Recently imported — but for LAST season, which is exactly the problem.
    expect(f.stale).toBe(true)
    expect(f.isFallback).toBe(true)
  })

  it('starts warning on 15 October, not before', () => {
    expect(assessFreshness(on('2026-10-14'), settings, current, null).stale).toBe(false)
    expect(assessFreshness(on('2026-10-15'), settings, current, null).stale).toBe(true)
  })

  it('stops warning after 1 April', () => {
    expect(assessFreshness(on('2027-04-01'), settings, current, null).stale).toBe(true)
    expect(assessFreshness(on('2027-04-02'), settings, current, null).stale).toBe(false)
  })

  it('respects a changed threshold', () => {
    const winter = on('2027-01-15')
    const strict = { ...settings, maxImportAgeDays: 3 }
    expect(assessFreshness(winter, strict, current, daysBefore(winter, 5)).stale).toBe(true)
  })
})

/**
 * Dates are the real 2026-2027 schedule, because the awkward cases are real:
 * a two-day Mammoth weekend, a five-race Friday-to-Sunday at Mammoth, and the
 * 5–7 March weekend that runs at Alpine on the Friday and Palisades Tahoe on
 * the Saturday and Sunday.
 */
import { describe, expect, it } from 'vitest'
import {
  entrantsOf,
  groupIntoWeekends,
  mondayOf,
  pacificDate,
  racesOnDays,
  reachOf,
  shortDay,
  validPreviewDate,
  visibleWeekend,
  weekendContaining,
  weekendOptions,
  weekendLabel,
  type WeekendRace,
} from './race-weekends'

let n = 0
const race = (
  date: string,
  venue: string,
  eligiblePersonIds: string[] = [],
  entrantPersonIds: string[] = eligiblePersonIds
): WeekendRace => ({
  id: `r${++n}`,
  name: `${venue} race`,
  date,
  discipline: 'GS',
  venue,
  eligiblePersonIds,
  entrantPersonIds,
})

const MARCH = [
  race('2027-03-05', 'Alpine'),
  race('2027-03-05', 'Alpine'),
  race('2027-03-06', 'Palisades Tahoe'),
  race('2027-03-07', 'Palisades Tahoe'),
]

const SEASON = [
  race('2026-12-05', 'Mammoth Mountain'),
  race('2026-12-06', 'Mammoth Mountain'),
  race('2027-01-22', 'Mammoth Mountain'),
  race('2027-01-23', 'Mammoth Mountain'),
  race('2027-01-24', 'Mammoth Mountain'),
  ...MARCH,
]

describe('pacificDate — the bug that would blank this block mid-afternoon', () => {
  it('is still the race day at 4pm Pacific, when UTC has moved on', () => {
    // 2026-12-05T23:30Z is 15:30 Saturday in Pacific — but toISOString() would
    // already say the 6th at 00:30Z an hour later, so the naive version drops
    // Saturday's race while Saturday is still running.
    expect(pacificDate(new Date('2026-12-06T00:30:00Z'))).toBe('2026-12-05')
    expect(new Date('2026-12-06T00:30:00Z').toISOString().slice(0, 10)).toBe('2026-12-06')
  })

  it('rolls over at Pacific midnight, not UTC midnight', () => {
    expect(pacificDate(new Date('2026-12-06T07:59:00Z'))).toBe('2026-12-05')
    expect(pacificDate(new Date('2026-12-06T08:01:00Z'))).toBe('2026-12-06')
  })
})

describe('groupIntoWeekends — contiguous dates, venue ignored', () => {
  it('keeps Alpine and Palisades Tahoe in one weekend', () => {
    const [w] = groupIntoWeekends(MARCH)
    expect(w.firstDate).toBe('2027-03-05')
    expect(w.lastDate).toBe('2027-03-07')
    expect(w.venues).toEqual(['Alpine', 'Palisades Tahoe'])
    expect(w.days).toHaveLength(3)
    expect(w.days[0].races).toHaveLength(2)
  })

  it('splits the season into its real weekends', () => {
    const weekends = groupIntoWeekends(SEASON)
    expect(weekends.map((w) => [w.firstDate, w.lastDate])).toEqual([
      ['2026-12-05', '2026-12-06'],
      ['2027-01-22', '2027-01-24'],
      ['2027-03-05', '2027-03-07'],
    ])
  })

  it('treats a two-day gap as a different weekend', () => {
    const w = groupIntoWeekends([race('2027-02-05', 'A'), race('2027-02-08', 'A')])
    expect(w).toHaveLength(2)
  })
})

describe('visibleWeekend — from the Monday of that week, and no sooner', () => {
  // 2026-12-05 is a Saturday, so its Monday is 2026-11-30.
  it('is hidden the Friday before', () => {
    expect(mondayOf('2026-12-05')).toBe('2026-11-30')
    expect(visibleWeekend(SEASON, '2026-11-27')).toBeNull()
  })

  it('appears on that Monday', () => {
    expect(visibleWeekend(SEASON, '2026-11-30')?.firstDate).toBe('2026-12-05')
  })

  it('is still showing on the last day of the weekend', () => {
    expect(visibleWeekend(SEASON, '2026-12-06')?.firstDate).toBe('2026-12-05')
  })

  it('disappears once the weekend has finished', () => {
    // 2026-12-07 is the Monday after, and January's weekend is weeks away.
    expect(visibleWeekend(SEASON, '2026-12-07')).toBeNull()
  })

  it('does not let a later weekend jump one still running', () => {
    const back_to_back = [
      race('2027-01-23', 'A'),
      race('2027-01-24', 'A'),
      race('2027-01-29', 'B'),
    ]
    // 2027-01-24 is a Sunday; the 29th is the Friday of the NEXT week, whose
    // Monday is the 25th. On the 24th the running weekend must still win.
    expect(visibleWeekend(back_to_back, '2027-01-24')?.firstDate).toBe('2027-01-23')
    expect(visibleWeekend(back_to_back, '2027-01-25')?.firstDate).toBe('2027-01-29')
  })
})

describe('reachOf — people, not entries', () => {
  it('counts somebody racing both days once', () => {
    const sat = race('2027-03-06', 'P', ['a', 'b', 'c'])
    const sun = race('2027-03-07', 'P', ['b', 'c', 'd'])
    expect(sat.eligiblePersonIds.length + sun.eligiblePersonIds.length).toBe(6)
    expect(reachOf([sat, sun])).toBe(4)
  })

  it('is zero for no races', () => {
    expect(reachOf([])).toBe(0)
  })
})

describe('entrantsOf — the total is a union too', () => {
  it('counts the real Mammoth shape as 45 people, not 86', () => {
    // 45 entrants on the Saturday, 41 on the Sunday, 41 of them the same
    // humans. Summing would promise a text about more people than exist.
    const all = Array.from({ length: 45 }, (_, i) => `p${i}`)
    const sat = race('2026-12-05', 'Mammoth', [], all)
    const sun = race('2026-12-06', 'Mammoth', [], all.slice(0, 41))
    expect(sat.entrantPersonIds.length + sun.entrantPersonIds.length).toBe(86)
    expect(entrantsOf([sat, sun])).toBe(45)
  })

  it('is independent of who can actually be texted', () => {
    const r = race('2027-03-06', 'P', ['a', 'b'], ['a', 'b', 'c', 'd'])
    expect(reachOf([r])).toBe(2)
    expect(entrantsOf([r])).toBe(4)
  })
})

describe('racesOnDays — picking any combination of days', () => {
  const [weekend] = groupIntoWeekends(MARCH)

  it('takes just the Friday, with both of its races', () => {
    expect(racesOnDays(weekend, ['2027-03-05'])).toHaveLength(2)
  })

  it('takes Saturday and Sunday but not Friday', () => {
    const picked = racesOnDays(weekend, ['2027-03-06', '2027-03-07'])
    expect(picked.map((r) => r.date)).toEqual(['2027-03-06', '2027-03-07'])
  })

  it('takes Friday and Sunday, skipping the middle', () => {
    const picked = racesOnDays(weekend, ['2027-03-05', '2027-03-07'])
    expect(picked.map((r) => r.date)).toEqual([
      '2027-03-05',
      '2027-03-05',
      '2027-03-07',
    ])
  })
})

describe('labels', () => {
  it('reads the weekday from the string, not a parsed Date', () => {
    // Parsing '2026-12-05' yields UTC midnight, which is the 4th in Pacific —
    // the fault this whole module is careful about.
    expect(shortDay('2026-12-05')).toBe('Sat 5')
    expect(shortDay('2027-03-07')).toBe('Sun 7')
  })

  it('spans a weekend, a single day, and a month boundary', () => {
    expect(weekendLabel(groupIntoWeekends(MARCH)[0])).toBe('5–7 March')
    expect(weekendLabel(groupIntoWeekends([race('2027-02-19', 'N')])[0])).toBe('19 February')
    expect(
      weekendLabel(
        groupIntoWeekends([race('2027-01-31', 'A'), race('2027-02-01', 'A')])[0]
      )
    ).toBe('31 January – 1 February')
  })
})

describe('validPreviewDate — the testing flag', () => {
  it('accepts a real date', () => {
    expect(validPreviewDate('2026-11-30')).toBe('2026-11-30')
    expect(validPreviewDate('2026-12-05')).toBe('2026-12-05')
  })

  it('ignores anything that is not exactly YYYY-MM-DD', () => {
    for (const bad of [undefined, '', '2026-1-5', '12/05/2026', 'today']) {
      expect(validPreviewDate(bad)).toBeNull()
    }
  })

  it('ignores a date that matches the pattern but does not exist', () => {
    // Dangerous rather than merely wrong: every comparison here is a string
    // comparison, so a rolled-over date would select a weekend rather than error.
    expect(validPreviewDate('2026-02-31')).toBeNull()
    expect(validPreviewDate('2026-13-01')).toBeNull()
  })
})

describe('weekendOptions — the choices the block offered, offered again', () => {
  const sat = race('2027-03-06', 'Palisades Tahoe', ['a', 'b', 'c'], ['a', 'b', 'c', 'd'])
  const sun = race('2027-03-07', 'Palisades Tahoe', ['b', 'c'], ['b', 'c', 'e'])

  it('offers the weekend and each day, with people-counts not row-counts', () => {
    const [w] = groupIntoWeekends([sat, sun])
    const opts = weekendOptions(w)
    expect(opts.map((o) => o.label)).toEqual([
      'Everyone racing this weekend',
      'Sat 6',
      'Sun 7',
    ])
    // 3 + 2 reachable rows, 3 people; 4 + 3 entered rows, 5 people.
    expect(opts[0]).toMatchObject({ reach: 3, entered: 5 })
  })

  it('offers single races only where a day has more than one', () => {
    const [w] = groupIntoWeekends([
      race('2027-03-05', 'Alpine', ['a']),
      race('2027-03-05', 'Alpine', ['b']),
      sat,
    ])
    const labels = weekendOptions(w).map((o) => o.label)
    expect(labels.filter((l) => l.includes('·'))).toHaveLength(2)
    expect(labels.some((l) => l.startsWith('Sat 6 ·'))).toBe(false)
  })

  it('leaves out a race nobody can be texted for', () => {
    const [w] = groupIntoWeekends([sat, race('2027-03-07', 'P', [], ['x'])])
    expect(weekendOptions(w).map((o) => o.label)).not.toContain('Sun 7')
  })

  it('does not offer "the whole weekend" when it is one day', () => {
    const [w] = groupIntoWeekends([sat])
    expect(weekendOptions(w).map((o) => o.label)).toEqual(['Sat 6'])
  })
})

describe('weekendContaining', () => {
  it('finds the weekend a selection belongs to', () => {
    const w = weekendContaining(SEASON, [SEASON[7].id])
    expect(w?.firstDate).toBe('2027-03-05')
  })

  it('is null for a race id that is not in the season', () => {
    expect(weekendContaining(SEASON, ['nope'])).toBeNull()
  })
})

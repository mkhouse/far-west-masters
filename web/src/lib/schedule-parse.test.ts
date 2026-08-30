import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRows, scheduleRows, decodeEntities } from './schedule-html'
import {
  expandRow,
  parseDateRange,
  parseDisciplines,
  parseEventName,
  parseSchedule,
  parseVenue,
  seasonYears,
  weekdayMismatch,
} from './schedule-parse'

/**
 * Both archived seasons, as fixtures.
 *
 * Real files rather than hand-written HTML on purpose. Every trap this parser exists
 * to survive — the missing closing tags, the contact block in the Location column,
 * 'SGx2', '(2x points)', the reschedule listed at both its dates — came out of these
 * files and would not have occurred to anyone inventing an example.
 *
 * 2026-27 is the prospective shape; 2025-26 is a completed winter, with three
 * cancellations, a make-up and a reschedule.
 */
const archive = (path: string) =>
  readFileSync(resolve(import.meta.dirname, '../../../archive', path), 'utf8')

const HTML_2627 = archive('2026-2027/schedule/race-schedule-2026-27.html')
const HTML_2526 = archive('2025-2026/schedule/schedule-table-final-2025-26.html')

describe('parseRows', () => {
  it('finds every row, including ones a naive regex loses', () => {
    // The count that matters. `/<tr>(.*?)<\/tr>/` finds 9 of these 12 — it drops the
    // three out-of-region races and reports a clean-looking answer while doing it.
    // A schedule importer that silently omits races is the failure mode here.
    expect(parseRows(HTML_2627)).toHaveLength(12)
  })

  it('keeps the row class, which is where this page records status', () => {
    const classes = parseRows(HTML_2526)
      .map((r) => r.className)
      .filter(Boolean)
    expect(classes).toContain('canceled')
    expect(classes).toContain('completed')
    expect(classes).toContain('out-of-region')
  })

  it('splits a cell on its line breaks rather than flattening it', () => {
    // The `<br>` rule: real content first, metadata after. Flattening loses the
    // boundary and leaves 'Race: TBA' to be stripped back out with patterns.
    const row = scheduleRows(HTML_2627)[1]
    expect(row.cells[3].segments[0]).toBe('GS / GS')
    expect(row.cells[3].text).toContain('Race: TBA')
  })

  it('drops the header row', () => {
    expect(scheduleRows(HTML_2627)).toHaveLength(11)
    expect(scheduleRows(HTML_2627)[0].cells[0].text).not.toMatch(/^date$/i)
  })
})

describe('decodeEntities', () => {
  it('decodes to SMS-safe characters, not typographic ones', () => {
    // A venue or event name parsed here can end up in a text message, where an em
    // dash or curly apostrophe forces UCS-2 and cuts the segment from 160 to 70.
    expect(decodeEntities('Alpine &mdash; Olympic Valley')).toBe(
      'Alpine - Olympic Valley'
    )
    expect(decodeEntities('Season&rsquo;s')).toBe("Season's")
  })
})

describe('seasonYears', () => {
  it('splits a season label into its two calendar years', () => {
    expect(seasonYears('2026-2027')).toEqual([2026, 2027])
  })
})

describe('parseDateRange', () => {
  it('reads a single day', () => {
    expect(parseDateRange('Feb. 19', '2026-2027')).toEqual(['2027-02-19'])
  })

  it('reads a range within one month', () => {
    expect(parseDateRange('Dec. 5-6', '2026-2027')).toEqual(['2026-12-05', '2026-12-06'])
  })

  it('puts December in the first year and spring in the second', () => {
    // The page never writes a year. Racing runs autumn to spring, so the same season
    // label covers two calendar years and the month decides which.
    expect(parseDateRange('Dec. 5', '2026-2027')).toEqual(['2026-12-05'])
    expect(parseDateRange('Mar. 5', '2026-2027')).toEqual(['2027-03-05'])
  })

  it('reads a range that crosses a month', () => {
    expect(parseDateRange('Feb. 28-Mar. 1', '2025-2026')).toEqual([
      '2026-02-28',
      '2026-03-01',
    ])
  })

  it('accepts a month spelled out', () => {
    expect(parseDateRange('December 6-7', '2025-2026')).toEqual([
      '2025-12-06',
      '2025-12-07',
    ])
  })

  it('returns nothing rather than guessing at an unreadable cell', () => {
    expect(parseDateRange('TBA', '2026-2027')).toEqual([])
  })
})

describe('weekdayMismatch', () => {
  it('is silent when the page and the computed date agree', () => {
    expect(weekdayMismatch('(Sat-Sun)', ['2026-12-05', '2026-12-06'])).toBeNull()
  })

  it('catches a wrong year, which is otherwise invisible', () => {
    // 5 December is a Saturday in 2026 and a Friday in 2025. Inferring the wrong year
    // gives correct-looking months and days for a whole season, and nothing
    // downstream would notice — so the club's own weekday annotation is the check.
    const message = weekdayMismatch('(Sat-Sun)', ['2025-12-05'])
    expect(message).toMatch(/Saturday/)
    expect(message).toMatch(/Friday/)
    expect(message).toMatch(/year is probably wrong/)
  })

  it('says nothing when the page gives no weekday to check against', () => {
    expect(weekdayMismatch('', ['2026-12-05'])).toBeNull()
  })
})

describe('parseDisciplines', () => {
  it('reads a single discipline', () => {
    expect(parseDisciplines('GS')).toEqual([{ discipline: 'GS', day: null }])
  })

  it('reads two separated by a slash', () => {
    expect(parseDisciplines('GS / GS').map((t) => t.discipline)).toEqual(['GS', 'GS'])
  })

  it('reads two separated by the word and', () => {
    expect(parseDisciplines('GS and SL').map((t) => t.discipline)).toEqual(['GS', 'SL'])
  })

  it('expands an x2 multiplier', () => {
    // The bug this pins: there is no word boundary between 'SG' and 'x', so `\bSG\b`
    // never matches 'SGx2'. Nakiska parsed as one race instead of five.
    expect(parseDisciplines('SGx2 / GSx2 / SL').map((t) => t.discipline)).toEqual([
      'SG', 'SG', 'GS', 'GS', 'SL',
    ])
  })

  it('expands a multiplier written with a run suffix', () => {
    expect(parseDisciplines('SGx2, GS_1x2, SL').map((t) => t.discipline)).toEqual([
      'SG', 'SG', 'GS', 'GS', 'SL',
    ])
  })

  it('does NOT treat a points multiplier as a race count', () => {
    // '(2x points)' doubles the points for ONE race. Reading it as 'x2' would invent
    // a race that does not exist and score a season against it.
    expect(parseDisciplines('SG (2x points)').map((t) => t.discipline)).toEqual(['SG'])
  })

  it('attaches races to the day the page names', () => {
    expect(parseDisciplines('Fri: SG / SG, Sat: SG / SG, Sun: GS')).toEqual([
      { discipline: 'SG', day: 'fri' },
      { discipline: 'SG', day: 'fri' },
      { discipline: 'SG', day: 'sat' },
      { discipline: 'SG', day: 'sat' },
      { discipline: 'GS', day: 'sun' },
    ])
  })

  it('ignores the unscored marker when counting races', () => {
    expect(parseDisciplines('DH / SG / GS / SL [unscored]')).toHaveLength(4)
  })

  it('does not find a discipline inside a longer word', () => {
    expect(parseDisciplines('Slalom training')).toEqual([])
  })
})

describe('parseVenue', () => {
  it('takes the resort out of a contact block', () => {
    expect(
      parseVenue({
        segments: ['Mammoth Mountain', 'Race Department', 'RaceAdmin@example.com'],
        text: 'Mammoth Mountain Race Department RaceAdmin@example.com',
      })
    ).toBe('Mammoth Mountain')
  })

  it('drops a trailing state and postcode so one venue is not two', () => {
    // These strings are matched against 18 years of race history. 'Sugar Bowl, CA'
    // and 'Sugar Bowl' becoming separate venues would detach new races from it.
    expect(parseVenue({ segments: ['Sugar Bowl, CA 95724'], text: '' })).toBe('Sugar Bowl')
    expect(parseVenue({ segments: ['Mammoth Mountain, CA'], text: '' })).toBe(
      'Mammoth Mountain'
    )
  })
})

describe('parseEventName', () => {
  it('reads a named event', () => {
    expect(parseEventName({ segments: ['Bernard Cup'] })).toBe('Bernard Cup')
  })

  it('drops a parenthetical aside', () => {
    expect(
      parseEventName({ segments: ['Northstar Speed Series (both Fri SG races are NSS)'] })
    ).toBe('Northstar Speed Series')
  })

  it('rejects the administrative boilerplate every row carries', () => {
    expect(parseEventName({ segments: ['Entries: $45 per race*'] })).toBeNull()
    expect(parseEventName({ segments: ['Registration opens November 2026'] })).toBeNull()
  })
})

describe('parseSchedule against the 2026-27 archive', () => {
  const { races, warnings } = parseSchedule(HTML_2627, '2026-2027')

  it('expands race weekends into individual races', () => {
    expect(races).toHaveLength(21)
  })

  it('puts one race on each day when the counts match', () => {
    const sugarBowl = races.filter((r) => r.venue === 'Sugar Bowl')
    expect(sugarBowl.map((r) => r.date)).toEqual(['2027-02-27', '2027-02-28'])
  })

  it('puts both races on the same day when the range is one day', () => {
    // 'SL / SL' on 'Mar. 5 (Fri)' is two races that Friday. The club writes
    // 'Fri: SG / SG' for the same shape elsewhere, which is what confirms it.
    const alpine = races.filter((r) => r.venue === 'Alpine')
    expect(alpine).toHaveLength(2)
    expect(alpine.every((r) => r.date === '2027-03-05')).toBe(true)
  })

  it('places each race on the weekday the page names', () => {
    const speed = races.filter((r) => r.eventName === 'Mammoth Speed Races')
    expect(speed.map((r) => `${r.date} ${r.discipline}`)).toEqual([
      '2027-01-22 SG',
      '2027-01-22 SG',
      '2027-01-23 SG',
      '2027-01-23 SG',
      '2027-01-24 GS',
    ])
  })

  it('marks out-of-region races as not counting', () => {
    const bigSky = races.filter((r) => r.venue === 'Big Sky Resort')
    expect(bigSky.length).toBeGreaterThan(0)
    expect(bigSky.every((r) => !r.countsForStandings)).toBe(true)
  })

  it('counts every in-region race toward standings', () => {
    const inRegion = races.filter((r) => r.venue !== 'Big Sky Resort')
    expect(inRegion.every((r) => r.countsForStandings)).toBe(true)
  })

  it('refuses to guess which day, rather than inventing an answer', () => {
    // Nationals: four disciplines across seven days, with nothing saying which is
    // when. Every row that lands here is out-of-region or unscored, so refusing
    // costs nothing that counts toward FWM standings.
    expect(warnings).toHaveLength(3)
    expect(warnings.map((w) => w.date)).toEqual([
      'Dec. 1-4 (Tue-Fri)',
      'Mar. 21-27 (Sun-Sat)',
      'Apr. 2-4 (Fri-Sun)',
    ])
  })

  it('counts the five Nakiska races even though it cannot place them', () => {
    // Proves the multiplier fix is what is being reported, not a miscount hidden
    // behind a warning.
    expect(warnings[2].message).toContain('5 races')
  })
})

describe('parseSchedule against the completed 2025-26 season', () => {
  const { races } = parseSchedule(HTML_2526, '2025-2026')

  it('marks cancelled races as cancelled', () => {
    const dec = races.filter((r) => r.date.startsWith('2025-12'))
    expect(dec.length).toBeGreaterThan(0)
    expect(dec.every((r) => r.status === 'canceled')).toBe(true)
  })

  it('keeps a reschedule at both dates, and does not decide what it means', () => {
    // The page lists the Viva Italia Cup at its original date (cancelled) and its new
    // one. Both are kept, with the club's own wording, because deciding what a
    // reschedule means to the standings is not an importer's judgement to make.
    const viva = races.filter((r) => r.eventName === 'Viva Italia Cup')
    const original = viva.filter((r) => r.date === '2026-02-28')
    const moved = viva.filter((r) => r.date === '2026-03-14')

    expect(original[0].status).toBe('canceled')
    expect(original[0].note).toMatch(/RESCHEDULED TO MAR 14-15/i)
    expect(moved[0].status).toBe('scheduled')
    expect(moved[0].note).toMatch(/RESCHEDULED FROM/i)
  })

  it('keeps the make-up race note', () => {
    const makeUp = races.find((r) => r.note?.match(/MAKE-?UP/i))
    expect(makeUp?.note).toMatch(/MAKE-UP RACE FOR DEC 6-7/i)
  })

  it('treats a completed row as a real race, not a cancelled one', () => {
    const bernard = races.filter((r) => r.eventName === 'Bernard Cup')
    expect(bernard).toHaveLength(2)
    expect(bernard.every((r) => r.status === 'scheduled')).toBe(true)
  })
})

describe('expandRow', () => {
  it('warns rather than throwing on a row with nothing in it', () => {
    const { races, warnings } = expandRow({ className: null, cells: [] }, 0, '2026-2027')
    expect(races).toEqual([])
    expect(warnings).toHaveLength(1)
  })
})

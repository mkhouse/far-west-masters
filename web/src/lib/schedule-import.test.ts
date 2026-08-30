import { describe, expect, it } from 'vitest'
import {
  buildScheduleDiff,
  raceKey,
  scheduleFingerprint,
  type ExistingRace,
} from './schedule-import'
import type { ParsedRace } from './schedule-parse'

const parsed = (over: Partial<ParsedRace> = {}): ParsedRace => ({
  date: '2027-03-06',
  discipline: 'GS',
  venue: 'Palisades Tahoe',
  eventName: 'Bernard Cup',
  countsForStandings: true,
  status: 'scheduled',
  note: null,
  sourceRow: 0,
  ...over,
})

const onFile = (over: Partial<ExistingRace> = {}): ExistingRace => ({
  id: 'race-1',
  date: '2027-03-06',
  discipline: 'GS',
  venue: 'Palisades Tahoe',
  name: 'Bernard Cup GS - March 06, 2027',
  status: 'scheduled',
  countsTowardStandings: true,
  liveTimingId: null,
  usssaRaceCode: null,
  notes: null,
  hasResults: false,
  ...over,
})

const opts = { season: '2026-2027' }

describe('raceKey', () => {
  it('identifies a race by date, discipline and venue', () => {
    expect(raceKey(parsed())).toBe('2027-03-06|GS|palisades tahoe')
  })

  it('ignores the event name, which the page can reword', () => {
    expect(raceKey(parsed({ eventName: 'Renamed Cup' }))).toBe(raceKey(parsed()))
  })
})

describe('buildScheduleDiff', () => {
  it('adds a race that is on the page and not on file', () => {
    const diff = buildScheduleDiff([parsed()], [], opts)
    expect(diff.toAdd).toHaveLength(1)
    expect(diff.toAdd[0].venue).toBe('Palisades Tahoe')
    expect(diff.toAdd[0].series).toBe('Bernard Cup')
  })

  it('reports nothing to do when the page matches the file', () => {
    const diff = buildScheduleDiff([parsed()], [onFile()], opts)
    expect(diff.toAdd).toEqual([])
    expect(diff.toChange).toEqual([])
    expect(diff.unchangedCount).toBe(1)
  })

  it('counts duplicates rather than matching one row to one row', () => {
    // 'SG / SG' on one day is two genuinely distinct races sharing a date, discipline
    // and venue. Matching by key alone would call the second one missing on every
    // import, forever.
    const two = [
      parsed({ discipline: 'SG', date: '2027-02-19', venue: 'Northstar California' }),
      parsed({ discipline: 'SG', date: '2027-02-19', venue: 'Northstar California' }),
    ]
    const one = [
      onFile({ discipline: 'SG', date: '2027-02-19', venue: 'Northstar California' }),
    ]

    const diff = buildScheduleDiff(two, one, opts)
    expect(diff.toAdd).toHaveLength(1)
    expect(diff.onFileNotOnPage).toEqual([])
    expect(diff.unchangedCount).toBe(1)
  })

  it('numbers races that share a day so their slugs stay unique', () => {
    const two = [parsed({ discipline: 'SL' }), parsed({ discipline: 'SL' })]
    const diff = buildScheduleDiff(two, [], opts)

    expect(diff.toAdd.map((r) => r.slug)).toEqual([
      '20270306-bernard-cup-sl-1of2',
      '20270306-bernard-cup-sl-2of2',
    ])
    expect(diff.toAdd[0].name).toMatch(/\(1 of 2\)$/)
  })

  it('takes the discipline factor from the season, not from today', () => {
    const diff = buildScheduleDiff([parsed({ discipline: 'SL' })], [], opts)
    expect(diff.toAdd[0].factor).toBe(730)
  })

  it('gives speed events one run and technical events two', () => {
    // The results importer refuses a two-run race that only has run 1 on live-timing,
    // so a single-run super-G marked as two runs would make it refuse a complete race.
    const diff = buildScheduleDiff(
      [parsed({ discipline: 'SG' }), parsed({ discipline: 'GS', date: '2027-03-07' })],
      [],
      opts
    )
    expect(diff.toAdd.find((r) => r.discipline === 'SG')!.runCount).toBe(1)
    expect(diff.toAdd.find((r) => r.discipline === 'GS')!.runCount).toBe(2)
  })

  it('updates a race the page has since cancelled', () => {
    const diff = buildScheduleDiff([parsed({ status: 'canceled' })], [onFile()], opts)
    expect(diff.toChange).toHaveLength(1)
    expect(diff.toChange[0].changes[0]).toEqual({
      field: 'status',
      from: 'scheduled',
      to: 'canceled',
    })
  })

  it('never downgrades a race that has been run', () => {
    // A race published as official must not be walked back to 'scheduled' because the
    // page still describes it as upcoming.
    const diff = buildScheduleDiff([parsed()], [onFile({ status: 'official' })], opts)
    expect(diff.toChange).toEqual([])
    expect(diff.conflicts).toEqual([])
  })

  it('holds back a change to a race that already has results', () => {
    // The rule that matters most here. Changing this race would rewrite a published
    // standing, and the parity harness checks those against every result since 2009.
    const diff = buildScheduleDiff(
      [parsed({ status: 'canceled' })],
      [onFile({ hasResults: true })],
      opts
    )

    expect(diff.toChange).toEqual([])
    expect(diff.conflicts).toHaveLength(1)
    expect(diff.conflicts[0].blockedReason).toMatch(/already has results/)
  })

  it('leaves a race that is on file but not on the page, and says so', () => {
    // Never deleted. Results hang off races, and a web page dropping a row is not
    // evidence that a race did not happen.
    const diff = buildScheduleDiff([], [onFile()], opts)
    expect(diff.onFileNotOnPage).toHaveLength(1)
    expect(diff.toAdd).toEqual([])
  })

  it('flags an empty parse instead of treating it as a clearance', () => {
    // A restructured page and "every race was removed" are indistinguishable from
    // here, so the apply action refuses on this flag.
    const diff = buildScheduleDiff([], [onFile(), onFile({ id: 'race-2' })], opts)
    expect(diff.empty).toBe(true)
  })

  it('is not empty merely because there is nothing to change', () => {
    expect(buildScheduleDiff([parsed()], [onFile()], opts).empty).toBe(false)
  })

  it('carries the not-counting flag onto a new race', () => {
    const diff = buildScheduleDiff([parsed({ countsForStandings: false })], [], opts)
    expect(diff.toAdd[0].countsTowardStandings).toBe(false)
  })

  it('notices when a race stops counting toward standings', () => {
    const diff = buildScheduleDiff(
      [parsed({ countsForStandings: false })],
      [onFile({ countsTowardStandings: true })],
      opts
    )
    expect(diff.toChange[0].changes[0].field).toBe('counts toward standings')
  })
})

describe('scheduleFingerprint', () => {
  it('is stable for the same content', () => {
    expect(scheduleFingerprint('<table><tr><td>a</td></tr></table>')).toBe(
      scheduleFingerprint('<table><tr><td>a</td></tr></table>')
    )
  })

  it('ignores reformatting', () => {
    // Reformatting the file should not read as the schedule having changed.
    expect(scheduleFingerprint('<tr>\n  <td>a</td>\n</tr>')).toBe(
      scheduleFingerprint('<tr> <td>a</td> </tr>')
    )
  })

  it('changes when the schedule does', () => {
    expect(scheduleFingerprint('<td>Mar. 6</td>')).not.toBe(
      scheduleFingerprint('<td>Mar. 7</td>')
    )
  })
})

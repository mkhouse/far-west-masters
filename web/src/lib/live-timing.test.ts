/**
 * Fixtures are real records, trimmed from the live-timing daily files for
 * 2026-03-07 (143 races nationwide) and 2026-12-05 (published, and empty).
 */
import { describe, expect, it } from 'vitest'
import {
  candidatesFor,
  dailyRacesUrl,
  parseDailyFile,
  raceNumberFromName,
  startMinutes,
  suggestId,
} from './live-timing'

/** The documented case: the only masters GS at Palisades that day, id 306870. */
const BERNARD_CUP =
  'MS=794150877.17038~' +
  'hMS=1|hN=C2=YSL 3|hT=Single Course=Combined of 2 runs|hR=Skiland Ski Area|hST=3/7/2026 1:00 PM|hID=307146|~' +
  'hMS=2|hN=U=Red Deere Canyon GS|hT=Giant Slalom=Women|hR=Canyon Ski Resort|hST=3/7/2026 9:00 AM|hID=307001|~' +
  'hMS=3|hN=U=BERNARD CUP MASTERS GS1|hT=Giant Slalom=Masters|hR=PALISADES TAHOE|hST=3/7/2026 10:00 AM|hID=306870|~' +
  // A junior race at the very same resort, same discipline, same day. Venue and
  // discipline alone would match this too.
  'hMS=4|hN=U=PALISADES JUNIOR GS|hT=Giant Slalom=U16|hR=PALISADES TAHOE|hST=3/7/2026 11:00 AM|hID=306999|~'

/** A day live-timing has published but not filled in — the real 5 Dec file. */
const NOT_YET_LISTED = 'MS=777749433.51649~'

const TWO_SUPER_GS =
  'MS=1~' +
  'hMS=1|hN=U=FW MASTERS SPEED SERIES - SG1 NSS|hT=Super G=Masters|hR=NORTHSTAR|hST=2/19/2027 9:30 AM|hID=400001|~' +
  'hMS=2|hN=U=FW MASTERS SPEED SERIES - SG2 NSS|hT=Super G=Masters|hR=NORTHSTAR|hST=2/19/2027 11:30 AM|hID=400002|~'

describe('dailyRacesUrl — one request per date, never per race', () => {
  it('builds the published path', () => {
    expect(dailyRacesUrl('2026-12-05')).toBe(
      'https://www.live-timing.com/dailyRaces/2026/races_2026-12-05.txt'
    )
  })
})

describe('parseDailyFile', () => {
  it('reads the pipe-and-tilde format', () => {
    const races = parseDailyFile(BERNARD_CUP)
    expect(races).toHaveLength(4)
    expect(races[2]).toMatchObject({
      id: '306870',
      venue: 'PALISADES TAHOE',
      name: 'U=BERNARD CUP MASTERS GS1',
      type: 'Giant Slalom=Masters',
    })
  })

  it('returns nothing for a day with no races in it', () => {
    expect(parseDailyFile(NOT_YET_LISTED)).toEqual([])
  })
})

describe('candidatesFor — masters only', () => {
  it('excludes a junior race at the same venue and discipline', () => {
    // The reason this filter exists: an id for the U16 GS at Palisades looks
    // exactly as plausible as the right one, and imports the wrong race.
    const cands = candidatesFor(parseDailyFile(BERNARD_CUP), {
      venue: 'Palisades Tahoe',
      discipline: 'GS',
    })
    expect(cands.map((c) => c.id)).toEqual(['306870'])
  })

  it('knows Palisades was called Squaw Valley', () => {
    const squaw = BERNARD_CUP.replace('PALISADES TAHOE|hST=3/7/2026 10:00', 'SQUAW VALLEY|hST=3/7/2026 10:00')
    const cands = candidatesFor(parseDailyFile(squaw), {
      venue: 'Palisades Tahoe',
      discipline: 'GS',
    })
    expect(cands.map((c) => c.id)).toContain('306870')
  })

  it('puts a day in running order', () => {
    const cands = candidatesFor(parseDailyFile(TWO_SUPER_GS), {
      venue: 'Northstar California',
      discipline: 'SG',
    })
    expect(cands.map((c) => c.id)).toEqual(['400001', '400002'])
  })
})

describe('suggestId', () => {
  it('finds the documented Bernard Cup id', () => {
    const s = suggestId(parseDailyFile(BERNARD_CUP), {
      venue: 'Palisades Tahoe',
      discipline: 'GS',
      sequence: null,
    })
    expect(s.id).toBe('306870')
  })

  it('tells an unlisted day apart from a failed match', () => {
    const notYet = suggestId(parseDailyFile(NOT_YET_LISTED), {
      venue: 'Mammoth Mountain',
      discipline: 'GS',
      sequence: null,
    })
    expect(notYet.id).toBeNull()
    expect(notYet.reason).toContain('not listed any races')

    const noMatch = suggestId(parseDailyFile(BERNARD_CUP), {
      venue: 'Mammoth Mountain',
      discipline: 'GS',
      sequence: null,
    })
    expect(noMatch.id).toBeNull()
    expect(noMatch.reason).toContain('none a masters race')
  })

  it('picks the right one of two by the number in its name', () => {
    const races = parseDailyFile(TWO_SUPER_GS)
    const venue = 'Northstar California'
    expect(suggestId(races, { venue, discipline: 'SG', sequence: 1 }).id).toBe('400001')
    expect(suggestId(races, { venue, discipline: 'SG', sequence: 2 }).id).toBe('400002')
  })

  it('refuses to guess between two indistinguishable races', () => {
    // Both named identically: nothing says which is FWM's "1 of 2". A plausible
    // wrong id imports another race's results under this one's name.
    const same = TWO_SUPER_GS.replace(/SG1 NSS/, 'NSS').replace(/SG2 NSS/, 'NSS')
    const s = suggestId(parseDailyFile(same), {
      venue: 'Northstar California',
      discipline: 'SG',
      sequence: 1,
    })
    expect(s.id).toBeNull()
    expect(s.candidates).toHaveLength(2)
  })
})

describe('helpers', () => {
  it('reads the race number from the last discipline-plus-digit', () => {
    expect(raceNumberFromName('BERNARD CUP MASTERS GS1')).toBe(1)
    expect(raceNumberFromName('FAR WEST MASTERS SG / DH - GS1')).toBe(1)
    expect(raceNumberFromName('FW MASTERS SPEED SERIES - SG3 NSS')).toBe(3)
    expect(raceNumberFromName('ALPINE MEADOWS MASTERS GS')).toBeNull()
  })

  it('orders by start time across noon', () => {
    expect(startMinutes('9:30 AM')).toBeLessThan(startMinutes('1:00 PM'))
    expect(startMinutes('12:30 PM')).toBe(12 * 60 + 30)
  })
})

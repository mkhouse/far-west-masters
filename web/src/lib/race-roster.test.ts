/**
 * Shapes taken from the real 2026-11-27 Mammoth Season Opener roster: 47
 * physical lines, 45 records, two race columns stating [45] and [41], 41 people
 * in both, four in the first only, nobody in neither.
 */
import { describe, expect, it } from 'vitest'
import { parseAsrCsv } from './asr-csv'
import {
  buildRaceDiff,
  countTempRacers,
  defaultWithdrawals,
  racerIdentity,
  raceColumns,
  toRosterRows,
  withdrawalKey,
  type ExistingEntry,
} from './race-roster'
import type { ExistingPerson } from './membership-import'

const R1 = 'Mammoth Season Opener GS #1 [GS] (12/31) [2]'
const R2 = 'Mammoth Season Opener GS #2 [GS] (12/31) [1]'

function csv(body: string): string {
  return (
    `"First Name","Last Name","Email","Phone","YOB","Gender","USSSA#","FIS#","Class","Allergies","${R1}","${R2}"\n` +
    body
  )
}

/** Ada is in both races; Grace only in the first. */
const TWO_RACERS = csv(
  '"Ada","Lovelace","ada@example.com","(530) 555-1234","1975","F","F5276696","","Class 8 Women","","11/01/2026 10:12:31 PST","11/01/2026 10:12:48 PST"\n' +
    '"Grace","Hopper","grace@example.com","5305559999","1966","F","X7424638","","Class 9 Women","","11/02/2026 09:00:00 PST",""\n'
)

const ada: ExistingPerson = {
  id: 'ada',
  first_name: 'Ada',
  last_name: 'Lovelace',
  usssa: 5276696,
  phone: '+15305551234',
  email: 'ada@example.com',
  opt_in_at: null,
}
const grace: ExistingPerson = {
  id: 'grace',
  first_name: 'Grace',
  last_name: 'Hopper',
  usssa: 7424638,
  phone: '+15305559999',
  email: 'grace@example.com',
  opt_in_at: null,
}

function diffFor(header: string, text: string, people: ExistingPerson[], existing: ExistingEntry[] = []) {
  const rows = parseAsrCsv(text)
  const col = raceColumns(rows).find((c) => c.header === header)!
  return buildRaceDiff(col, rows, toRosterRows(rows), people, existing)
}

describe('raceColumns — the file names its own races', () => {
  it('reads the name, discipline, date label and stated count', () => {
    const cols = raceColumns(parseAsrCsv(TWO_RACERS))
    expect(cols).toHaveLength(2)
    expect(cols[0]).toMatchObject({
      name: 'Mammoth Season Opener GS #1',
      discipline: 'GS',
      dateLabel: '12/31',
      statedCount: 2,
    })
  })

  it('does not mistake an ordinary column for a race', () => {
    // Matched by shape, not position — a column appended to the export would
    // otherwise quietly become a race.
    const cols = raceColumns(parseAsrCsv(TWO_RACERS))
    expect(cols.map((c) => c.header)).not.toContain('Allergies')
    expect(cols.map((c) => c.header)).not.toContain('Class')
  })
})

describe('toRosterRows — the columns are spelled differently here', () => {
  it('reads USSSA# with three S, and Phone rather than Cell Phone', () => {
    const [row] = toRosterRows(parseAsrCsv(TWO_RACERS))
    expect(row.usssa).toBe(5276696)
    expect(row.phone).toBe('+15305551234')
  })

  it('survives a newline inside a quoted field', () => {
    // One real row's allergies run to two lines; the record count is what
    // matters, not the line count.
    const text = csv(
      '"Thomas","Bullard","t@example.com","7752256648","1950","M","F6477258","","Class 11 Men","Amoxicillin\nand a device implant","11/19/2026 21:33:37 PST",""\n'
    )
    expect(parseAsrCsv(text)).toHaveLength(1)
    expect(toRosterRows(parseAsrCsv(text))[0].lastName).toBe('Bullard')
  })
})

describe('buildRaceDiff — a timestamp is the entry', () => {
  it('counts only the people with a timestamp in that race column', () => {
    const first = diffFor(R1, TWO_RACERS, [ada, grace])
    const second = diffFor(R2, TWO_RACERS, [ada, grace])
    expect(first.inFile).toBe(2)
    expect(second.inFile).toBe(1)
    expect(second.newEntries.map((e) => e.personId)).toEqual(['ada'])
  })

  it('checks the count ASR printed in the header', () => {
    expect(diffFor(R1, TWO_RACERS, [ada, grace]).countMatches).toBe(true)
    // Same file, header claiming three.
    const lying = TWO_RACERS.replace('(12/31) [2]', '(12/31) [3]')
    expect(diffFor(R1.replace('[2]', '[3]'), lying, [ada, grace]).countMatches).toBe(false)
  })

  it('does not re-add somebody already entered', () => {
    const d = diffFor(R1, TWO_RACERS, [ada, grace], [{ personId: 'ada', name: 'Ada Lovelace' }])
    expect(d.alreadyEntered).toBe(1)
    expect(d.newEntries.map((e) => e.personId)).toEqual(['grace'])
  })
})

describe('withdrawal — the row stays, the cell empties', () => {
  it('is an empty cell on somebody we have entered', () => {
    // Grace is in the file, but her second-race cell is blank.
    const d = diffFor(R2, TWO_RACERS, [ada, grace], [
      { personId: 'ada', name: 'Ada Lovelace' },
      { personId: 'grace', name: 'Grace Hopper' },
    ])
    expect(d.withdrawn).toEqual([
      { personId: 'grace', name: 'Grace Hopper', stillInFile: true },
    ])
  })

  it('distinguishes a withdrawal from vanishing out of the event', () => {
    // Nobody named Grace anywhere in this file.
    const onlyAda = csv(
      '"Ada","Lovelace","ada@example.com","(530) 555-1234","1975","F","F5276696","","Class 8 Women","","11/01/2026 10:12:31 PST","11/01/2026 10:12:48 PST"\n'
    )
    const d = diffFor(R2, onlyAda, [ada, grace], [
      { personId: 'ada', name: 'Ada Lovelace' },
      { personId: 'grace', name: 'Grace Hopper' },
    ])
    expect(d.withdrawn).toEqual([
      { personId: 'grace', name: 'Grace Hopper', stillInFile: false },
    ])
  })

  it('is not triggered on a first import, when we hold nothing', () => {
    // Grace has no second-race cell, but she was never entered, so nothing has
    // been withdrawn — she simply is not in that race.
    expect(diffFor(R2, TWO_RACERS, [ada, grace]).withdrawn).toEqual([])
  })

  it('ticks every withdrawal for removal by default', () => {
    const d = diffFor(R2, TWO_RACERS, [ada, grace], [
      { personId: 'grace', name: 'Grace Hopper' },
    ])
    expect(defaultWithdrawals([d])).toEqual(new Set([withdrawalKey(R2, 'grace')]))
  })
})

describe('temp racers — expected, not an error', () => {
  it('reports an entrant who matches nobody, and does not count them as an entry', () => {
    const d = diffFor(R1, TWO_RACERS, [ada])
    expect(d.tempRacers.map((e) => e.racer.lastName)).toEqual(['Hopper'])
    expect(d.newEntries.map((e) => e.personId)).toEqual(['ada'])
  })

  it('matches on email when there is no USSA number at all', () => {
    // One real entrant has an empty USSSA# column.
    const noUssa = csv(
      '"Jim","Craig","jim@example.com","562-254-5387","1953","M","","","Class 10 Men","","11/25/2026 15:14:52 PST",""\n'
    )
    const jim: ExistingPerson = {
      id: 'jim',
      first_name: 'Jim',
      last_name: 'Craig',
      usssa: null,
      phone: null,
      email: 'jim@example.com',
      opt_in_at: null,
    }
    const d = diffFor(R1, noUssa, [jim])
    expect(d.tempRacers).toEqual([])
    expect(d.newEntries[0]).toMatchObject({ personId: 'jim', matchedBy: 'email' })
  })
})

describe('countTempRacers — one human, one person', () => {
  it('does not count somebody racing both days twice', () => {
    // The bug this exists to stop: summing each race's tempRacers told the
    // officer a 45-person file would create 47 people.
    const rows = parseAsrCsv(TWO_RACERS)
    const racers = toRosterRows(rows)
    const cols = raceColumns(rows)
    // Nobody is in the club, so everyone in the file is a temp racer.
    const diffs = cols.map((c) => buildRaceDiff(c, rows, racers, [], []))

    expect(diffs[0].tempRacers).toHaveLength(2)
    expect(diffs[1].tempRacers).toHaveLength(1)
    expect(diffs[0].tempRacers.length + diffs[1].tempRacers.length).toBe(3)
    expect(countTempRacers(diffs)).toBe(2)
  })

  it('identifies by USSA, then email, then phone — never the name', () => {
    expect(racerIdentity({ usssa: 5276696, email: 'a@b.c', phone: '+1' })).toBe('u:5276696')
    expect(racerIdentity({ usssa: null, email: 'A@B.c', phone: '+1' })).toBe('e:a@b.c')
    expect(racerIdentity({ usssa: null, email: '', phone: '+15305551234' })).toBe('p:+15305551234')
  })
})

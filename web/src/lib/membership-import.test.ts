/**
 * What a membership export would do, before it does it.
 *
 * The export is CUMULATIVE and is imported repeatedly through the season. So the
 * second run sees 160 rows it already knows and 8 it does not, and the interesting
 * question is never "what is in the file" but "what would change". Most of these
 * cases are about that distinction.
 */

import { describe, expect, it } from 'vitest'
import {
  buildDiff,
  contactChanges,
  contactDifferences,
  matchPerson,
  parseAsrDate,
  changeCount,
  entriesWithChanges,
  toMemberRows,
  type ExistingPerson,
  type MemberRow,
} from './membership-import'

function row(over: Record<string, string> = {}): Record<string, string> {
  return {
    'First Name': 'Ada',
    'Last Name': 'Lovelace',
    YOB: '1975',
    Gender: 'F',
    'USSA#': 'F5276696',
    'FIS#': '',
    'Cell Phone': '(530) 555-1234',
    Email: 'ada@example.com',
    Class: 'W5',
    'FarWest Bib Number': '142',
    'Race Series': 'Far West',
    'Registration Date': '11/03/2025 09:14:22 PST',
    Event_id: '413378',
    ...over,
  }
}

const member = (over: Partial<MemberRow> = {}): MemberRow => ({
  ...toMemberRows([row()])[0],
  ...over,
})

const person = (over: Partial<ExistingPerson> = {}): ExistingPerson => ({
  id: 'ada',
  first_name: 'Ada',
  last_name: 'Lovelace',
  usssa: 5276696,
  phone: '+15305551234',
  email: 'ada@example.com',
  opt_in_at: null,
  ...over,
})

describe('toMemberRows', () => {
  it('drops the letter prefix from the USSA number', () => {
    // Real prefixes in the 2025-2026 export: X, F, C, E. The column is a bigint and
    // every match is on the digits.
    for (const prefix of ['F', 'X', 'C', 'E', 'P', '']) {
      expect(toMemberRows([row({ 'USSA#': `${prefix}5276696` })])[0].usssa).toBe(5276696)
    }
  })

  it('normalises the phone number', () => {
    expect(toMemberRows([row()])[0].phone).toBe('+15305551234')
  })

  it('keeps a number it cannot read as null rather than guessing', () => {
    expect(toMemberRows([row({ 'Cell Phone': '555-1234' })])[0].phone).toBeNull()
  })

  it('treats blank optional fields as null, not empty strings', () => {
    const m = toMemberRows([row({ 'FarWest Bib Number': '', Class: '', 'FIS#': '' })])[0]
    expect(m.bib).toBeNull()
    expect(m.className).toBeNull()
    expect(m.fis).toBeNull()
  })

  // Bibs are assigned to only about four fifths of members, so a missing one is
  // normal and must not make the row unusable.
  it('keeps a member with no bib', () => {
    expect(toMemberRows([row({ 'FarWest Bib Number': '' })])).toHaveLength(1)
  })

  it('reads the race series without filtering on it', () => {
    // The racer's home division, not the membership purchased. One member races for
    // Midwest and still holds FWM membership — filtering here would drop them.
    const m = toMemberRows([row({ 'Race Series': 'Midwest' })])[0]
    expect(m.raceSeries).toBe('Midwest')
    expect(m.eventId).toBe('413378')
  })

  it('does not read anything medical or residential', () => {
    const m = toMemberRows([
      row({ Allergies: 'insurance and patient record numbers', Address: '1 Main St' }),
    ])[0]
    expect(Object.values(m).join(' ')).not.toContain('insurance')
    expect(Object.values(m).join(' ')).not.toContain('Main St')
  })
})

describe('parseAsrDate', () => {
  it('reads ASR’s format', () => {
    expect(parseAsrDate('11/03/2025 09:14:22 PST')).toBe('2025-11-03T12:00:00.000Z')
  })

  // A membership with an unknown join date is still a membership. Inventing a date
  // would make "who joined since the last import" quietly wrong.
  it('returns null rather than guessing', () => {
    expect(parseAsrDate('')).toBeNull()
    expect(parseAsrDate('not a date')).toBeNull()
  })
})

describe('matchPerson', () => {
  it('matches on USSA number first', () => {
    const byUsssa = person({ id: 'by-usssa', email: 'other@example.com', phone: null })
    const byEmail = person({ id: 'by-email', usssa: 999 })
    expect(matchPerson(member(), [byEmail, byUsssa])?.person.id).toBe('by-usssa')
  })

  it('falls back to email, then phone', () => {
    expect(
      matchPerson(member(), [person({ id: 'e', usssa: 999 })])?.matchedBy
    ).toBe('email')
    expect(
      matchPerson(member(), [person({ id: 'p', usssa: 999, email: 'x@example.com' })])
        ?.matchedBy
    ).toBe('phone')
  })

  it('matches email case-insensitively', () => {
    const p = person({ usssa: 999, email: 'ADA@EXAMPLE.COM', phone: null })
    expect(matchPerson(member(), [p])?.matchedBy).toBe('email')
  })

  it('finds nobody rather than guessing', () => {
    expect(
      matchPerson(member(), [person({ usssa: 999, email: 'x@example.com', phone: '+15305559999' })])
    ).toBeNull()
  })

  it('does not match on a USSA number the row does not have', () => {
    const m = member({ usssa: null, email: '', phone: null })
    expect(matchPerson(m, [person({ usssa: null, email: null, phone: null })])).toBeNull()
  })
})

describe('contactChanges — fill blanks, never overwrite', () => {
  // THE RULE CHANGED on 2026-08-16. It used to keep our value only when the person
  // had opted in for texts, and take ASR's otherwise. Melissa spotted the flaw while
  // reading a preview: email was collected through the opt-in form long before this
  // system existed, so an address on file is very often the member's own — including
  // for people whose opt_in_at never came across in the migration, who are exactly
  // the ones the old rule would have overwritten.

  it('fills a missing email', () => {
    expect(contactChanges(member(), person({ email: null }))).toContainEqual({
      field: 'email',
      from: null,
      to: 'ada@example.com',
    })
  })

  it('fills a missing phone number', () => {
    expect(contactChanges(member(), person({ phone: null })).map((c) => c.field)).toContain('phone')
  })

  it('fills a missing USSA number', () => {
    expect(contactChanges(member(), person({ usssa: null })).map((c) => c.field)).toContain('usssa')
  })

  it('never overwrites an email we already hold', () => {
    const p = person({ email: 'from-the-optin-form@example.com', opt_in_at: null })
    expect(contactChanges(member(), p).map((c) => c.field)).not.toContain('email')
  })

  it('never overwrites a phone number we already hold', () => {
    const p = person({ phone: '+15305559999', opt_in_at: null })
    expect(contactChanges(member(), p).map((c) => c.field)).not.toContain('phone')
  })

  it('never overwrites a USSA number we already hold', () => {
    expect(contactChanges(member(), person({ usssa: 111 })).map((c) => c.field)).not.toContain('usssa')
  })

  // Opting in is no longer part of the rule at all. It used to be the thing that
  // protected a value, and protecting only opted-in people was the bug.
  it('protects a value whether or not the person has opted in', () => {
    const optedIn = person({ email: 'ours@example.com', opt_in_at: '2026-01-01T00:00:00Z' })
    const never = person({ email: 'ours@example.com', opt_in_at: null })
    expect(contactChanges(member(), optedIn)).toEqual([])
    expect(contactChanges(member(), never)).toEqual([])
  })

  it('reports nothing when everything already agrees', () => {
    expect(contactChanges(member(), person())).toEqual([])
  })
})

describe('contactDifferences — reported, never applied', () => {
  it('reports an email ASR disagrees with', () => {
    const p = person({ email: 'ours@example.com' })
    expect(contactDifferences(member(), p)).toContainEqual({
      field: 'email',
      from: 'ours@example.com',
      to: 'ada@example.com',
    })
  })

  it('reports a differing phone number and USSA number', () => {
    const p = person({ phone: '+15305559999', usssa: 111 })
    const fields = contactDifferences(member(), p).map((c) => c.field)
    expect(fields).toContain('phone')
    expect(fields).toContain('usssa')
  })

  // A gap is not a disagreement. Filling one is reported as a change, not as a
  // difference, or the same person would appear in both lists.
  it('does not report a blank as a difference', () => {
    const p = person({ email: null, phone: null, usssa: null })
    expect(contactDifferences(member(), p)).toEqual([])
  })

  it('ignores case when comparing email', () => {
    expect(contactDifferences(member(), person({ email: 'ADA@EXAMPLE.COM' }))).toEqual([])
  })

  it('reports nothing when everything agrees', () => {
    expect(contactDifferences(member(), person())).toEqual([])
  })
})

describe('buildDiff — what would change', () => {
  const ada = person({ id: 'ada' })
  const grace = person({
    id: 'grace',
    first_name: 'Grace',
    last_name: 'Hopper',
    usssa: 7654321,
    email: 'grace@example.com',
    phone: '+15305555678',
  })

  it('reports somebody with no membership for this season as joined', () => {
    const diff = buildDiff([member()], [ada], new Set())
    expect(diff.joined).toHaveLength(1)
    expect(diff.unchanged).toBe(0)
  })

  // The case that makes a repeat import readable: already a member, nothing changed.
  it('counts an unchanged existing member rather than listing them', () => {
    const diff = buildDiff([member()], [ada], new Set(['ada']))
    expect(diff.unchanged).toBe(1)
    expect(diff.joined).toEqual([])
    expect(diff.updated).toEqual([])
  })

  it('lists an existing member when a gap would be filled', () => {
    const gap = person({ id: 'ada', phone: null })
    const diff = buildDiff([member()], [gap], new Set(['ada']))
    expect(diff.updated).toHaveLength(1)
    expect(diff.updated[0].changes[0].field).toBe('phone')
  })

  // A difference is not applied, but it must still surface the person — otherwise it
  // would disappear into the "unchanged" count and never be seen.
  it('lists an existing member whose details merely differ from ASR', () => {
    const differing = person({ id: 'ada', phone: '+15305559999' })
    const diff = buildDiff([member()], [differing], new Set(['ada']))
    expect(diff.updated).toHaveLength(1)
    expect(diff.updated[0].changes).toEqual([])
    expect(diff.updated[0].differences[0].field).toBe('phone')
  })

  it('reports somebody nobody matches as unmatched', () => {
    const diff = buildDiff([member()], [grace], new Set())
    expect(diff.unmatched).toHaveLength(1)
    expect(diff.joined).toEqual([])
  })

  // Flagged, never acted on. A cumulative export missing somebody means a refund or
  // a correction in ASR, and that is a decision for a person.
  it('flags a member who has disappeared from the export', () => {
    const diff = buildDiff([member()], [ada, grace], new Set(['ada', 'grace']))
    expect(diff.missing).toEqual([{ personId: 'grace', name: 'Grace Hopper' }])
  })

  it('does not flag anyone as missing on a first import', () => {
    expect(buildDiff([member()], [ada], new Set()).missing).toEqual([])
  })

  it('accounts for every row in the file exactly once', () => {
    const rows = [member(), member({ usssa: 7654321, email: 'grace@example.com' }), member({ usssa: 1, email: 'nobody@example.com', phone: null })]
    const diff = buildDiff(rows, [ada, grace], new Set(['ada']))
    const accounted =
      diff.joined.length + diff.updated.length + diff.unchanged + diff.unmatched.length
    expect(accounted).toBe(diff.rowsInFile)
  })

  it('is idempotent — running the same export twice changes nothing the second time', () => {
    const rows = [member()]
    const first = buildDiff(rows, [ada], new Set())
    expect(first.joined).toHaveLength(1)

    // After applying, ada holds a membership for the season.
    const second = buildDiff(rows, [ada], new Set(['ada']))
    expect(second.joined).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.missing).toEqual([])
    expect(second.unchanged).toBe(1)
  })
})

describe('what the preview reports', () => {
  const ada = { id: 'ada', first_name: 'Ada', last_name: 'Lovelace', usssa: null, phone: '+15305551234', email: 'old@example.com', opt_in_at: null }

  // The bug this exists for: on a FIRST import everybody lands in `joined`, so
  // counting only `updated` reported zero contact changes while thirteen were about
  // to be applied to real member records.
  it('counts gaps filled on people who are joining, not only on existing members', () => {
    // ada holds an email already, so only the missing USSA number is filled — and
    // the differing email is reported separately rather than applied.
    const diff = buildDiff([member()], [ada], new Set())
    expect(diff.updated).toHaveLength(0)
    expect(entriesWithChanges(diff)).toHaveLength(1)
    expect(changeCount(diff)).toBe(1)
  })

  it('counts corrections on existing members too', () => {
    const diff = buildDiff([member()], [ada], new Set(['ada']))
    expect(diff.updated).toHaveLength(1)
    expect(entriesWithChanges(diff)).toHaveLength(1)
  })

  it('reports nothing when nothing would change', () => {
    const settled = { ...ada, email: 'ada@example.com', usssa: 5276696 }
    const diff = buildDiff([member()], [settled], new Set(['ada']))
    expect(entriesWithChanges(diff)).toEqual([])
    expect(changeCount(diff)).toBe(0)
  })
})

describe('the preview carries whether the member opted in', () => {
  // It is the fact that decides a disagreement, so it has to reach the screen where
  // the decision is made. Measured on the 2025-2026 export: nine of fifteen
  // disagreements were with people who had opted in through Airtable, and for those
  // the address on file is their own answer.
  const optedIn = { id: 'in', first_name: 'Ada', last_name: 'L', usssa: 5276696, phone: '+15305551234', email: 'ours@example.com', opt_in_at: '2026-01-01T00:00:00Z' }
  const never = { ...optedIn, id: 'out', opt_in_at: null }

  it('reports an opted-in member as such', () => {
    const diff = buildDiff([member()], [optedIn], new Set())
    expect(diff.joined[0].optedIn).toBe(true)
  })

  it('reports a member who never opted in as such', () => {
    const diff = buildDiff([member()], [never], new Set())
    expect(diff.joined[0].optedIn).toBe(false)
  })

  it('reports somebody not in the club at all as not opted in', () => {
    const diff = buildDiff([member()], [], new Set())
    expect(diff.unmatched[0].optedIn).toBe(false)
  })

  // Opting in decides how a disagreement is PRESENTED; it must not decide what is
  // applied. That was the old rule, and silently keeping the value is what hid nine
  // of these from view.
  it('does not change what would be applied', () => {
    const a = buildDiff([member()], [optedIn], new Set())
    const b = buildDiff([member()], [never], new Set())
    expect(a.joined[0].changes).toEqual(b.joined[0].changes)
    expect(a.joined[0].differences).toEqual(b.joined[0].differences)
  })
})

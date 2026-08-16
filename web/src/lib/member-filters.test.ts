/**
 * Directory filters.
 *
 * These decide two different things: which rows the members directory shows, and
 * who a message reaches when the send button is pressed on that list. They must be
 * the same rule — a filter meaning one thing on screen and another at send time is
 * the specific bug this module exists to prevent, and the one Melissa caught by
 * eye before it shipped (task #47).
 *
 * Note what these tests deliberately do NOT assert: that a filter can make somebody
 * reachable. It cannot — the consent gate applies on top of any filter, and that is
 * tested in audiences.test.ts.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMBERSHIP,
  MEMBERSHIP,
  applyFilter,
  describeFilter,
  filterFromParams,
  filterToParams,
  type FilterablePerson,
  type MemberFilter,
} from './member-filters'

function person(over: Partial<FilterablePerson> = {}): FilterablePerson {
  return {
    id: crypto.randomUUID(),
    first_name: 'Ada',
    last_name: 'Lovelace',
    status: 'active_member',
    usssa: 1234567,
    phone: '+15305551234',
    email: 'ada@example.com',
    opt_in_at: '2026-01-01T00:00:00Z',
    intro_sent_at: '2026-01-02T00:00:00Z',
    opted_out_at: null,
    sms_never: false,
    // Holds a membership for the season being shown. Set by the caller from
    // lib/membership.ts in the real thing — see the membership grouping tests.
    is_member: true,
    ...over,
  }
}

const ALL: MemberFilter = {
  membership: 'all',
  texting: null,
  missingUsssa: false,
  query: '',
}

describe('filterFromParams', () => {
  it('defaults to active members, which is what the directory opens on', () => {
    expect(filterFromParams({}).membership).toBe(DEFAULT_MEMBERSHIP)
    expect(DEFAULT_MEMBERSHIP).toBe('active')
  })

  it('accepts a known membership grouping', () => {
    expect(filterFromParams({ membership: 'inactive' }).membership).toBe('inactive')
    expect(filterFromParams({ membership: 'all' }).membership).toBe('all')
  })

  // A URL is user-editable, and a nonsense value must not mean "everyone". Falling
  // back to the default keeps a mistyped link narrower than intended, never wider.
  it('falls back to the default for an unknown grouping', () => {
    expect(filterFromParams({ membership: 'nonsense' }).membership).toBe(DEFAULT_MEMBERSHIP)
  })

  it('trims the search query', () => {
    expect(filterFromParams({ q: '  lovelace  ' }).query).toBe('lovelace')
  })

  it('reads the missing-USSA flag only from its exact value', () => {
    expect(filterFromParams({ missing: 'usssa' }).missingUsssa).toBe(true)
    expect(filterFromParams({ missing: 'yes' }).missingUsssa).toBe(false)
    expect(filterFromParams({}).missingUsssa).toBe(false)
  })

  it('round-trips through filterToParams', () => {
    const original: MemberFilter = {
      membership: 'inactive',
      texting: 'eligible',
      missingUsssa: true,
      query: 'lovelace',
    }
    expect(filterFromParams(filterToParams(original) as never)).toEqual(original)
  })
})

describe('applyFilter — membership groupings', () => {
  // CHANGED IN TASK #52, and this is the point of the change. "Active" used to mean
  // a value on the person, which was wrong for 63 people when checked against the
  // AdminSkiRacing export. It now means holding a membership for the season being
  // shown — a row in the memberships table, imported from ASR.
  //
  // people.status still says what KIND of person somebody is, which is what separates
  // a member who has not renewed from somebody who was never a member at all.

  it('counts anyone holding a membership as active, whatever their status says', () => {
    const people = [
      person({ status: 'active_member', is_member: true }),
      person({ status: 'officer', is_member: true }),
      // The case that was previously wrong: status says inactive, ASR says they paid.
      person({ status: 'inactive', is_member: true }),
      person({ status: 'asr_import', is_member: true }),
    ]
    expect(applyFilter(people, { ...ALL, membership: 'active' })).toHaveLength(4)
  })

  it('does not count somebody as active because their status says so', () => {
    // The other half of the same bug: marked active_member, never actually joined.
    const people = [person({ status: 'active_member', is_member: false })]
    expect(applyFilter(people, { ...ALL, membership: 'active' })).toHaveLength(0)
    expect(applyFilter(people, { ...ALL, membership: 'inactive' })).toHaveLength(1)
  })

  it('treats a member who has not renewed as inactive', () => {
    const people = [
      person({ status: 'active_member', is_member: false }),
      person({ status: 'officer', is_member: false }),
      person({ status: 'inactive', is_member: false }),
    ]
    expect(applyFilter(people, { ...ALL, membership: 'inactive' })).toHaveLength(3)
  })

  it('treats somebody who was never a member as a non-member', () => {
    const people = ['sms_opt_in', 'out_of_region', 'temp_racer', 'non_member'].map((status) =>
      person({ status, is_member: false })
    )
    expect(applyFilter(people, { ...ALL, membership: 'non_members' })).toHaveLength(4)
  })

  // On 1 September membership lapses and nobody holds a row for the new season, so
  // everybody leaves "Active" without anything running. This is that, in one test.
  it('empties Active when nobody holds a membership for the season', () => {
    const people = [
      person({ status: 'active_member', is_member: false }),
      person({ status: 'officer', is_member: false }),
      person({ status: 'sms_opt_in', is_member: false }),
    ]
    expect(applyFilter(people, { ...ALL, membership: 'active' })).toHaveLength(0)
    // And everybody is still somewhere — they have not vanished from the directory.
    const elsewhere =
      applyFilter(people, { ...ALL, membership: 'inactive' }).length +
      applyFilter(people, { ...ALL, membership: 'non_members' }).length
    expect(elsewhere).toBe(3)
  })

  it('returns everyone when the grouping is "all"', () => {
    const people = [
      person({ status: 'active_member', is_member: true }),
      person({ status: 'inactive', is_member: false }),
      person({ status: 'sms_opt_in', is_member: false }),
    ]
    expect(applyFilter(people, ALL)).toHaveLength(3)
  })

  it('puts every person in exactly one grouping', () => {
    // No overlap and no gap: the three chips must account for the directory.
    const people = [
      person({ status: 'active_member', is_member: true }),
      person({ status: 'officer', is_member: true }),
      person({ status: 'active_member', is_member: false }),
      person({ status: 'inactive', is_member: false }),
      person({ status: 'asr_import', is_member: false }),
      person({ status: 'sms_opt_in', is_member: false }),
      person({ status: 'out_of_region', is_member: false }),
      person({ status: 'temp_racer', is_member: false }),
    ]

    for (const p of people) {
      const hits = Object.keys(MEMBERSHIP).filter(
        (key) => applyFilter([p], { ...ALL, membership: key }).length === 1
      )
      expect(hits, `${p.status} / member=${p.is_member}`).toHaveLength(1)
    }
  })

  it('treats a person with no membership lookup as not a member', () => {
    // A caller that has not looked up memberships is not entitled to call anybody a
    // current member, so an absent flag must read as false rather than as unknown.
    const p = person({ status: 'active_member' })
    delete (p as { is_member?: boolean }).is_member
    expect(applyFilter([p], { ...ALL, membership: 'active' })).toHaveLength(0)
  })
})

describe('applyFilter — search', () => {
  const people = [
    person({ first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' }),
    person({ first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com' }),
  ]

  it('matches on name, case-insensitively', () => {
    expect(applyFilter(people, { ...ALL, query: 'lovelace' })).toHaveLength(1)
    expect(applyFilter(people, { ...ALL, query: 'GRACE' })).toHaveLength(1)
  })

  it('matches on a first and last name together', () => {
    expect(applyFilter(people, { ...ALL, query: 'ada lovelace' })).toHaveLength(1)
  })

  it('matches on email', () => {
    expect(applyFilter(people, { ...ALL, query: 'grace@' })).toHaveLength(1)
  })

  // However the number was typed, it should find the person. This is how officers
  // actually search: reading a number off a phone screen, punctuation and all.
  it.each(['5305551234', '(530) 555-1234', '530-555-1234', '+15305551234'])(
    'matches a phone number typed as %s',
    (query) => {
      expect(applyFilter([person()], { ...ALL, query })).toHaveLength(1)
    }
  )

  it('does not treat one or two digits as a phone search', () => {
    // "55" appears in the number, but a two-digit query is somebody typing a name.
    // Matching on it would return most of the club.
    expect(applyFilter([person({ first_name: 'Ada', last_name: 'X' })], {
      ...ALL,
      query: '55',
    })).toHaveLength(0)
  })

  it('returns nobody when nothing matches', () => {
    expect(applyFilter(people, { ...ALL, query: 'nobody' })).toHaveLength(0)
  })
})

describe('applyFilter — texting state and USSA', () => {
  it('filters by consent state, using the same rule as the directory labels', () => {
    const people = [
      person(),
      person({ opt_in_at: null }),
      person({ intro_sent_at: null }),
      person({ phone: null }),
    ]
    expect(applyFilter(people, { ...ALL, texting: 'eligible' })).toHaveLength(1)
    expect(applyFilter(people, { ...ALL, texting: 'not_opted_in' })).toHaveLength(1)
    expect(applyFilter(people, { ...ALL, texting: 'awaiting_intro' })).toHaveLength(1)
    expect(applyFilter(people, { ...ALL, texting: 'no_phone' })).toHaveLength(1)
  })

  it('finds people with no USSA number, which is what the fill-in flow needs', () => {
    const people = [person({ usssa: null }), person({ usssa: 1234567 })]
    const found = applyFilter(people, { ...ALL, missingUsssa: true })
    expect(found).toHaveLength(1)
    expect(found[0].usssa).toBeNull()
  })

  it('combines every filter as AND', () => {
    const people = [
      person({ is_member: true, usssa: null, last_name: 'Lovelace' }),
      person({ is_member: false, usssa: null, last_name: 'Lovelace' }),
      person({ is_member: true, usssa: 1234567, last_name: 'Lovelace' }),
      person({ is_member: true, usssa: null, last_name: 'Hopper' }),
    ]
    const found = applyFilter(people, {
      membership: 'active',
      texting: 'eligible',
      missingUsssa: true,
      query: 'lovelace',
    })
    expect(found).toHaveLength(1)
  })
})

describe('describeFilter', () => {
  // This wording lands in the send log, where months later it is the only record of
  // who a message went to. "filtered" would answer nothing.
  it('describes an unfiltered list as everyone', () => {
    expect(describeFilter(ALL)).toBe('Everyone')
  })

  it('names the membership grouping', () => {
    expect(describeFilter({ ...ALL, membership: 'active' })).toBe('Active')
  })

  it('reads as a sentence when several filters are combined', () => {
    expect(
      describeFilter({
        membership: 'non_members',
        texting: 'eligible',
        missingUsssa: false,
        query: '',
      })
    ).toBe('Non-members · opted-in for texts')
  })

  it('includes the search terms', () => {
    expect(describeFilter({ ...ALL, query: 'lovelace' })).toContain('lovelace')
  })

  it('mentions a missing USSA number', () => {
    expect(describeFilter({ ...ALL, missingUsssa: true })).toContain('missing USSA')
  })
})

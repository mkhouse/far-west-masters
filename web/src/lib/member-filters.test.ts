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
  it('counts officers as active, since they are members too', () => {
    const people = [person({ status: 'active_member' }), person({ status: 'officer' })]
    expect(applyFilter(people, { ...ALL, membership: 'active' })).toHaveLength(2)
  })

  it('gathers every non-member status under one grouping', () => {
    const people = MEMBERSHIP.non_members.statuses.map((status) => person({ status }))
    expect(applyFilter(people, { ...ALL, membership: 'non_members' })).toHaveLength(
      people.length
    )
  })

  it('returns everyone when the grouping is "all"', () => {
    const people = [
      person({ status: 'active_member' }),
      person({ status: 'inactive' }),
      person({ status: 'sms_opt_in' }),
    ]
    expect(applyFilter(people, ALL)).toHaveLength(3)
  })

  it('keeps the groupings disjoint, so nobody is counted twice', () => {
    const statuses = Object.values(MEMBERSHIP).flatMap((g) => g.statuses)
    expect(new Set(statuses).size).toBe(statuses.length)
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
      person({ status: 'active_member', usssa: null, last_name: 'Lovelace' }),
      person({ status: 'inactive', usssa: null, last_name: 'Lovelace' }),
      person({ status: 'active_member', usssa: 1234567, last_name: 'Lovelace' }),
      person({ status: 'active_member', usssa: null, last_name: 'Hopper' }),
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

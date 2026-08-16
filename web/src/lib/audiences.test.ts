/**
 * The consent gate.
 *
 * This is the most important test file in the messaging app. Three migrations —
 * 0020, 0021 and 0022 — went into removing every path by which a message could
 * reach somebody who had not opted in. Nothing in the code stops that work being
 * quietly undone by a future change; these tests do.
 *
 * The property being defended: a person who has not opted in, has not been sent the
 * intro text, has opted out, is suppressed, or has no phone number, must never
 * appear in a sendable audience. No filter, no group, no combination of options may
 * widen who is reachable — only narrow it.
 *
 * WHAT IS AND IS NOT COVERED HERE, in three layers:
 *
 *   1. `explainExclusions` is pure, and is tested directly and exhaustively. It IS
 *      the gate.
 *   2. `resolveAudience` runs against a stub database, proving the gate is applied
 *      in JavaScript to whatever a query returns.
 *   3. The stub records each predicate, so the queries themselves are asserted —
 *      see "the queries ask the database for the right people" at the foot of this
 *      file. That layer exists because mutation testing found it missing: removing
 *      the opt-in requirement from the intro_pending query left the whole suite
 *      green, which would have meant intro texts going to people who never opted in.
 *
 * What remains uncovered is Postgres itself. These tests prove the query asks for
 * what we meant; only an integration test against a real database proves it comes
 * back with the right rows.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { explainExclusions, resolveAudience } from './audiences'
import type { FilterablePerson } from './member-filters'

// ---------------------------------------------------------------------------
// A stub Supabase client.
//
// Every query in audiences.ts is a chain (.select().eq().not()...) that resolves to
// { data }. The stub returns the rows registered for a table and ignores the
// filters, which is what makes the JavaScript-side gate observable: it hands back
// everyone, and the assertions check who survives.
//
// It also RECORDS each call in the chain. Without that, anything expressed in SQL
// rather than in JavaScript is invisible here — mutation testing confirmed it, by
// removing the opt-in requirement from the intro_pending query and watching the
// whole suite still pass. Recording the predicates closes that hole: it cannot
// prove Postgres returns the right rows, but it does prove the query asks for what
// we meant.
// ---------------------------------------------------------------------------
let tables: Record<string, unknown[]> = {}

interface RecordedQuery {
  table: string
  calls: Array<{ method: string; args: unknown[] }>
}
let queries: RecordedQuery[] = []

function stubQuery(table: string, rows: unknown[]) {
  const record: RecordedQuery = { table, calls: [] }
  queries.push(record)

  const chain: Record<string, unknown> = {
    single: async () => ({ data: rows[0] ?? null }),
    maybeSingle: async () => ({ data: rows[0] ?? null }),
    // Awaiting the chain itself yields the rows, as PostgREST does.
    then: (resolve: (v: { data: unknown[] }) => unknown) =>
      Promise.resolve({ data: rows }).then(resolve),
  }

  for (const method of ['select', 'eq', 'not', 'is', 'in', 'order'] as const) {
    chain[method] = (...args: unknown[]) => {
      record.calls.push({ method, args })
      return chain
    }
  }

  return chain
}

vi.mock('./supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => stubQuery(table, tables[table] ?? []),
  }),
}))

/**
 * Every predicate applied to the query against `table`, as [method, ...args].
 *
 * Throws when no query was made at all, so dropping a query entirely fails just as
 * loudly as narrowing it wrongly.
 */
function predicates(table: string): unknown[][] {
  const q = queries.find((q) => q.table === table)
  if (!q) {
    throw new Error(
      `no query was made against "${table}" — queried: ${
        queries.map((q) => q.table).join(', ') || 'nothing'
      }`
    )
  }
  return q.calls.map((c) => [c.method, ...c.args])
}

beforeEach(() => {
  tables = {}
  queries = []
})

/** A member who has cleared every part of the gate. */
function eligible(over: Partial<FilterablePerson> = {}): FilterablePerson {
  return {
    id: crypto.randomUUID(),
    first_name: 'Test',
    last_name: 'Member',
    status: 'active_member',
    usssa: 1234567,
    phone: '+15305551234',
    email: 'test@example.com',
    opt_in_at: '2026-01-01T00:00:00Z',
    intro_sent_at: '2026-01-02T00:00:00Z',
    opted_out_at: null,
    sms_never: false,
    ...over,
  }
}

describe('explainExclusions — the gate itself', () => {
  it('lets through somebody who has cleared every check', () => {
    const { eligible: n, excluded } = explainExclusions([eligible()])
    expect(n).toBe(1)
    expect(excluded).toEqual([])
  })

  // Each of these is a way somebody must NOT be reachable. If any of these ever
  // reports eligible: 1, the club is texting somebody who did not agree to it.
  it.each([
    ['no phone number', { phone: null }, 'no phone number'],
    ['opted out by texting STOP', { opted_out_at: '2026-02-01T00:00:00Z' }, 'opted out'],
    ['suppressed by an officer', { sms_never: true }, 'suppressed'],
    ['never opted in', { opt_in_at: null }, 'not opted-in for texts'],
    ['opted in but never introduced', { intro_sent_at: null }, 'no intro text sent'],
  ])('excludes somebody with %s', (_label, override, reason) => {
    const { eligible: n, excluded } = explainExclusions([eligible(override)])
    expect(n).toBe(0)
    expect(excluded).toEqual([{ reason, count: 1 }])
  })

  it('reports each excluded person exactly once, by the blocking reason', () => {
    // No phone AND no opt-in AND opted out. Reporting all three would make the
    // counts sum to more than the number of humans, which reads as a bug in the
    // numbers rather than an explanation of them.
    const { eligible: n, excluded } = explainExclusions([
      eligible({ phone: null, opt_in_at: null, opted_out_at: '2026-02-01T00:00:00Z' }),
    ])
    expect(n).toBe(0)
    expect(excluded).toEqual([{ reason: 'no phone number', count: 1 }])
  })

  it('counts every person exactly once across a mixed list', () => {
    const people = [
      eligible(),
      eligible(),
      eligible({ phone: null }),
      eligible({ opt_in_at: null }),
      eligible({ intro_sent_at: null }),
      eligible({ sms_never: true }),
      eligible({ opted_out_at: '2026-02-01T00:00:00Z' }),
    ]
    const { eligible: n, excluded } = explainExclusions(people)
    const accounted = n + excluded.reduce((sum, e) => sum + e.count, 0)
    expect(n).toBe(2)
    expect(accounted).toBe(people.length)
  })

  it('reports nothing for an empty candidate set', () => {
    expect(explainExclusions([])).toEqual({ eligible: 0, excluded: [] })
  })
})

describe('resolveAudience applies the gate to every audience', () => {
  const mixed = () => [
    eligible(),
    eligible({ opt_in_at: null }),
    eligible({ intro_sent_at: null }),
    eligible({ opted_out_at: '2026-02-01T00:00:00Z' }),
    eligible({ sms_never: true }),
    eligible({ phone: null }),
  ]

  it('reaches only the eligible member in all_eligible', async () => {
    tables.people = mixed()
    const result = await resolveAudience('all_eligible')
    expect(result.recipientCount).toBe(1)
    expect(result.consideredCount).toBe(6)
    expect(result.incompleteConsent).toBe(false)
  })

  it('reaches only the eligible member in a group', async () => {
    // Migration 0020 removed the test-group exemption. This is the regression test
    // for that: a group is not a way around the gate, however it is configured.
    tables.recipient_groups = [{ name: 'Board' }]
    tables.recipient_group_members = mixed().map((p) => ({ people: p }))
    const result = await resolveAudience('group', { groupId: 'g1' })
    expect(result.recipientCount).toBe(1)
    expect(result.consideredCount).toBe(6)
    expect(result.incompleteConsent).toBe(false)
  })

  it('reaches only the eligible member in the always-notify list', async () => {
    tables.people = mixed()
    const result = await resolveAudience('always')
    expect(result.recipientCount).toBe(1)
    expect(result.incompleteConsent).toBe(false)
  })

  it('accounts for everyone it considered', async () => {
    tables.people = mixed()
    const { recipientCount, consideredCount, excluded } =
      await resolveAudience('all_eligible')
    const accounted = recipientCount + excluded.reduce((s, e) => s + e.count, 0)
    expect(accounted).toBe(consideredCount)
  })
})

describe('a filter can only narrow the audience, never widen it', () => {
  // The safety property behind task #47: the filter picks candidates, and the gate
  // then applies on top, unconditionally. If this ever inverts, choosing "not
  // opted-in for texts" in the directory would text exactly the people who refused.
  const filter = {
    membership: 'all',
    texting: null,
    missingUsssa: false,
    query: '',
  }

  it('applies the gate after the filter has chosen candidates', async () => {
    tables.people = [
      eligible(),
      eligible({ opt_in_at: null }),
      eligible({ opted_out_at: '2026-02-01T00:00:00Z' }),
    ]
    const result = await resolveAudience('filtered', { filter })
    expect(result.consideredCount).toBe(3)
    expect(result.recipientCount).toBe(1)
  })

  it('reaches nobody when the filter selects only people who have not opted in', async () => {
    tables.people = [
      eligible({ opt_in_at: null }),
      eligible({ opt_in_at: null }),
      eligible({ opt_in_at: null }),
    ]
    const result = await resolveAudience('filtered', {
      filter: { ...filter, texting: 'not_opted_in' },
    })
    expect(result.consideredCount).toBe(3)
    expect(result.recipientCount).toBe(0)
  })

  it('reaches nobody when the filter selects opted-out people', async () => {
    tables.people = [eligible({ opted_out_at: '2026-02-01T00:00:00Z' })]
    const result = await resolveAudience('filtered', {
      filter: { ...filter, texting: 'opted_out' },
    })
    expect(result.recipientCount).toBe(0)
  })

  it('refuses to resolve without a filter rather than defaulting to everyone', async () => {
    tables.people = [eligible(), eligible()]
    const result = await resolveAudience('filtered')
    expect(result.recipientCount).toBe(0)
    expect(result.unavailableReason).toBeTruthy()
  })
})

describe('intro_pending is the one audience with incomplete consent', () => {
  // Not a bypass: everyone here has opted in. What they lack is the intro text, and
  // this send is what supplies it. The flag exists so the compose screen can say so
  // rather than the exception being invisible.
  it('is flagged as incomplete consent', async () => {
    tables.people = [eligible({ intro_sent_at: null })]
    const result = await resolveAudience('intro_pending')
    expect(result.incompleteConsent).toBe(true)
  })

  it('is the only audience so flagged', async () => {
    tables.people = [eligible()]
    tables.recipient_groups = [{ name: 'Board' }]
    tables.recipient_group_members = [{ people: eligible() }]
    tables.race_entries = []

    for (const kind of ['all_eligible', 'always', 'group', 'series'] as const) {
      const result = await resolveAudience(kind, { groupId: 'g1', series: 'Mammoth' })
      expect(result.incompleteConsent, `${kind} must not be flagged`).toBe(false)
    }
  })

  it('still excludes people who opted out, were suppressed, or have no phone', async () => {
    // The query supplies people who have opted in and lack an intro. Of those, the
    // ones who have since said STOP, been suppressed, or have no number must not be
    // texted — "needs an intro text" does not override any of that.
    tables.people = [
      eligible({ intro_sent_at: null }),
      eligible({ intro_sent_at: null, opted_out_at: '2026-02-01T00:00:00Z' }),
      eligible({ intro_sent_at: null, sms_never: true }),
      eligible({ intro_sent_at: null, phone: null }),
    ]
    const result = await resolveAudience('intro_pending')
    expect(result.recipientCount).toBe(1)
    expect(result.consideredCount).toBe(4)
  })
})

describe('the queries ask the database for the right people', () => {
  // These assert the SQL predicates, not the rows that come back. The stub ignores
  // filters, so without this block anything expressed in SQL is untested — proven by
  // mutation testing, where removing the opt-in requirement from intro_pending left
  // the entire suite green. This cannot prove Postgres returns the right rows; that
  // still needs an integration test. It proves the query asks for what we meant.

  it('intro_pending asks only for people who opted in and have no intro text', async () => {
    tables.people = [eligible({ intro_sent_at: null })]
    await resolveAudience('intro_pending')

    // Both halves matter. Without the first, the intro text — the one message that
    // reaches people mid-consent — would go to people who never opted in at all.
    expect(predicates('people')).toContainEqual(['not', 'opt_in_at', 'is', null])
    // Without the second, everyone would be re-introduced on every send.
    expect(predicates('people')).toContainEqual(['is', 'intro_sent_at', null])
  })

  it('always asks for people who opted in to race texts, not those who did not', async () => {
    tables.people = [eligible()]
    await resolveAudience('always')
    expect(predicates('people')).toContainEqual(['eq', 'sms_always', true])
  })

  it('all_eligible narrows nobody in SQL, leaving the gate to do the work', async () => {
    // Deliberate: the consent gate is applied in one place, in JavaScript, where it
    // can also explain who it excluded and why. A predicate added here would filter
    // people out silently and make the "31 of 48" account wrong.
    tables.people = [eligible()]
    await resolveAudience('all_eligible')
    expect(predicates('people').filter(([method]) => method !== 'select')).toEqual([])
  })

  it('a group asks only for that group', async () => {
    tables.recipient_groups = [{ name: 'Board' }]
    tables.recipient_group_members = [{ people: eligible() }]
    await resolveAudience('group', { groupId: 'g1' })
    expect(predicates('recipient_group_members')).toContainEqual(['eq', 'group_id', 'g1'])
  })

  it('a series asks only for entries in that series', async () => {
    tables.race_entries = []
    await resolveAudience('series', { series: 'Mammoth' })
    expect(predicates('race_entries')).toContainEqual(['eq', 'races.series', 'Mammoth'])
  })

  it('reads the same consent columns for every audience', async () => {
    // One column list, so a query cannot quietly omit a signal the gate depends on:
    // a missing `opted_out_at` would arrive as undefined and read as "not opted out".
    tables.people = [eligible()]
    for (const kind of ['all_eligible', 'always', 'intro_pending'] as const) {
      queries = []
      await resolveAudience(kind)
      const [, columns] = predicates('people').find(([m]) => m === 'select') as [string, string]
      for (const column of ['phone', 'opted_out_at', 'sms_never', 'opt_in_at', 'intro_sent_at']) {
        expect(columns, `${kind} must read ${column}`).toContain(column)
      }
    }
  })
})

describe('an intro that already failed is held back', () => {
  // Somebody whose intro was permanently rejected looks identical in `people` to
  // somebody never introduced: opt_in_at set, intro_sent_at null. Sending again
  // cannot work — the carrier refused the number — so leaving them in means every
  // campaign run re-sends to them and the count never reaches zero.
  //
  // See lib/intro-failures.ts. Registered here on message_recipients because that is
  // where the failure actually lives; nothing is stored on the person.
  it('excludes them, and says so separately from the other exclusions', async () => {
    const stranded = eligible({ id: 'bad-number', intro_sent_at: null })
    const waiting = eligible({ id: 'never-sent', intro_sent_at: null })
    tables.people = [stranded, waiting]
    tables.message_recipients = [
      { person_id: 'bad-number', phone: '+15305550100', error: 'Landline', error_code: '30006' },
    ]

    const result = await resolveAudience('intro_pending')

    expect(result.recipientCount).toBe(1)
    expect(result.consideredCount).toBe(2)
    // Named on its own, because the remedy differs: this one needs a phone call,
    // not another text.
    expect(result.excluded).toContainEqual({
      reason: 'intro text already failed — bad number',
      count: 1,
    })
  })

  it('leaves the audience alone when nothing has failed', async () => {
    tables.people = [eligible({ id: 'a', intro_sent_at: null })]
    tables.message_recipients = []
    const result = await resolveAudience('intro_pending')
    expect(result.recipientCount).toBe(1)
    expect(result.excluded).toEqual([])
  })

  it('only looks at permanently failed deliveries of intro messages', async () => {
    tables.people = [eligible({ id: 'a', intro_sent_at: null })]
    tables.message_recipients = []
    await resolveAudience('intro_pending')

    expect(predicates('message_recipients')).toContainEqual([
      'in', 'delivery_status', ['failed', 'undelivered'],
    ])
    expect(predicates('message_recipients')).toContainEqual([
      'in', 'messages.audience_kind', ['opt_in_auto', 'opt_in_review', 'series_intro'],
    ])
  })
})

/**
 * Matching an opt-in submission to a member.
 *
 * Two things can go wrong here and both are bad in different ways. Failing to match
 * creates a second record for somebody already in the club, splitting their consent
 * from their race history. Matching too eagerly attaches one person's consent to
 * another person's record — and then texts them.
 *
 * NOTE THE STUB BELOW ACTUALLY FILTERS. An earlier version of the audience tests
 * used a stub that ignored predicates and returned whatever was registered, which
 * meant the assertions proved less than they appeared to. Here the stub applies
 * `eq` and `ilike` to a real array, so a test that says "matched on email" has
 * genuinely exercised the email lookup rather than been handed the answer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findMatch, resolveEmail, resolvePhone } from './opt-in-review'

interface StubPerson {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
  usssa: number | null
  [key: string]: unknown
}

let people: StubPerson[] = []

vi.mock('./supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const filters: Array<(p: StubPerson) => boolean> = []
      const rows = () => people.filter((p) => filters.every((f) => f(p)))

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.push((p) => p[col] === val)
          return chain
        },
        // No wildcards are used against this column, so ilike is case-insensitive
        // equality — which is what the real query means by it.
        ilike: (col: string, val: string) => {
          filters.push(
            (p) => String(p[col] ?? '').toLowerCase() === String(val).toLowerCase()
          )
          return chain
        },
        limit: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: rows()[0] ?? null }),
        then: (resolve: (v: { data: StubPerson[] }) => unknown) =>
          Promise.resolve({ data: rows() }).then(resolve),
      }
      return chain
    },
  }),
}))

function member(over: Partial<StubPerson> = {}): StubPerson {
  return {
    id: crypto.randomUUID(),
    first_name: 'Ada',
    last_name: 'Lovelace',
    phone: '+15305551234',
    email: 'ada@example.com',
    usssa: 1234567,
    status: 'active_member',
    opt_in_at: null,
    intro_sent_at: null,
    opted_out_at: null,
    sms_never: false,
    ...over,
  }
}

/** A submission carrying only the fields the matcher reads. */
function submission(over: Partial<Parameters<typeof findMatch>[0]> = {}) {
  return {
    phone: '+15305551234',
    phone_raw: '(530) 555-1234',
    email: 'ada@example.com',
    usssa: 1234567,
    ...over,
  }
}

beforeEach(() => {
  people = []
})

describe('findMatch', () => {
  it('finds nobody when the club holds nobody', async () => {
    expect(await findMatch(submission())).toBeNull()
  })

  it('matches on mobile number', async () => {
    const ada = member()
    people = [ada]
    const found = await findMatch(submission({ email: 'different@example.com', usssa: null }))
    expect(found?.person.id).toBe(ada.id)
    expect(found?.matchedBy).toBe('phone')
  })

  it('matches on email when the number is not on file', async () => {
    const ada = member({ phone: '+15305559999' })
    people = [ada]
    const found = await findMatch(submission({ usssa: null }))
    expect(found?.person.id).toBe(ada.id)
    expect(found?.matchedBy).toBe('email')
  })

  it('matches on email regardless of case', async () => {
    people = [member({ phone: null, email: 'Ada@Example.COM' })]
    const found = await findMatch(submission({ email: 'ada@example.com', usssa: null }))
    expect(found?.matchedBy).toBe('email')
  })

  it('matches on USSA number when neither number nor email is on file', async () => {
    const ada = member({ phone: '+15305559999', email: 'old@example.com' })
    people = [ada]
    const found = await findMatch(submission())
    expect(found?.person.id).toBe(ada.id)
    expect(found?.matchedBy).toBe('usssa')
  })

  // The order is the safety property, not a detail. A phone number is what the club
  // actually texts, so it decides. A USSA number is typed by hand on a public form,
  // where a transposed digit would otherwise attach somebody's consent — and their
  // intro text — to a stranger's record.
  describe('prefers identifiers in order of how much they are worth', () => {
    it('takes the phone match over an email match on a different person', async () => {
      const byPhone = member({ id: 'phone-match', email: 'someone-else@example.com' })
      const byEmail = member({ id: 'email-match', phone: '+15305559999' })
      people = [byEmail, byPhone]

      const found = await findMatch(submission())
      expect(found?.person.id).toBe('phone-match')
      expect(found?.matchedBy).toBe('phone')
    })

    it('takes the email match over a USSA match on a different person', async () => {
      const byEmail = member({ id: 'email-match', phone: '+15305559999', usssa: 9999999 })
      const byUsssa = member({ id: 'usssa-match', phone: '+15305558888', email: 'x@example.com' })
      people = [byUsssa, byEmail]

      const found = await findMatch(submission())
      expect(found?.person.id).toBe('email-match')
      expect(found?.matchedBy).toBe('email')
    })
  })

  // A submission whose number failed to normalise was stored with phone: null. If
  // toE164 is fixed later, that member should stop being lost — so the matcher
  // normalises the raw text again rather than trusting the stored value.
  it('re-normalises the raw number when none was stored', async () => {
    const ada = member()
    people = [ada]
    const found = await findMatch(
      submission({ phone: null, phone_raw: '1 (530) 555-1234', email: 'x@example.com', usssa: null })
    )
    expect(found?.person.id).toBe(ada.id)
    expect(found?.matchedBy).toBe('phone')
  })

  it('does not match on a USSA number the submission never gave', async () => {
    // The submission's USSA is null. Matching anyone here would mean treating
    // "no number" as a value that can be equal to something.
    people = [member({ phone: '+15305559999', email: 'other@example.com', usssa: null })]
    expect(
      await findMatch(submission({ phone: null, phone_raw: '', email: 'nobody@example.com', usssa: null }))
    ).toBeNull()
  })

  it('does not match on an empty email', async () => {
    people = [member({ phone: '+15305559999', email: '', usssa: null })]
    expect(
      await findMatch(submission({ phone: null, phone_raw: '', email: '', usssa: null }))
    ).toBeNull()
  })
})

describe('resolvePhone — which number wins', () => {
  // The rule: the number typed into the form beats the number on file. Somebody
  // filling in a page headed "register your mobile number" is saying where they want
  // texts, and that is more recent and more direct than an imported value.
  //
  // This is pure, so unlike the matcher above it needs no stub at all.

  it('takes the number from the form over the one on file', () => {
    const decided = resolvePhone(
      { phone: '+15305551234' },
      { phone: '+15305559999', phone_raw: '(530) 555-9999' }
    )
    expect(decided.phone).toBe('+15305559999')
    expect(decided.changed).toBe(true)
    expect(decided.from).toBe('+15305551234')
  })

  it('reports no change when the two agree', () => {
    const decided = resolvePhone(
      { phone: '+15305551234' },
      { phone: '+15305551234', phone_raw: '(530) 555-1234' }
    )
    expect(decided.phone).toBe('+15305551234')
    expect(decided.changed).toBe(false)
    expect(decided.from).toBeNull()
  })

  // Filling a blank is not replacing anything. Reporting it as a change would put a
  // "number updated" note on a record that never had one.
  it('fills a missing number without calling it a change', () => {
    const decided = resolvePhone(
      { phone: null },
      { phone: '+15305559999', phone_raw: '(530) 555-9999' }
    )
    expect(decided.phone).toBe('+15305559999')
    expect(decided.changed).toBe(false)
  })

  it('keeps the number on file when the form gives nothing usable', () => {
    const decided = resolvePhone(
      { phone: '+15305551234' },
      { phone: null, phone_raw: 'not a number' }
    )
    expect(decided.phone).toBe('+15305551234')
    expect(decided.changed).toBe(false)
  })

  it('normalises the raw text when no normalised number was stored', () => {
    const decided = resolvePhone(
      { phone: '+15305551234' },
      { phone: null, phone_raw: '1 (530) 555-9999' }
    )
    expect(decided.phone).toBe('+15305559999')
    expect(decided.changed).toBe(true)
  })

  describe('the officer override', () => {
    it('keeps the number on file when asked to', () => {
      const decided = resolvePhone(
        { phone: '+15305551234' },
        { phone: '+15305559999', phone_raw: '(530) 555-9999' },
        true
      )
      expect(decided.phone).toBe('+15305551234')
      expect(decided.changed).toBe(false)
    })

    it('still fills a blank, since there is nothing to keep', () => {
      const decided = resolvePhone(
        { phone: null },
        { phone: '+15305559999', phone_raw: '(530) 555-9999' },
        true
      )
      expect(decided.phone).toBe('+15305559999')
    })
  })

  it('never reports a from-number without reporting a change', () => {
    // The note written to the submission is built from `from`, so a stray value here
    // would record a phone number that never moved.
    const cases = [
      resolvePhone({ phone: null }, { phone: '+15305559999', phone_raw: 'x' }),
      resolvePhone({ phone: '+15305551234' }, { phone: null, phone_raw: 'x' }),
      resolvePhone({ phone: '+15305551234' }, { phone: '+15305551234', phone_raw: 'x' }),
    ]
    for (const c of cases) expect(c.from).toBeNull()
  })
})

describe('resolveEmail — which address wins', () => {
  // THE FORM WINS, including over an address already on file (Melissa, 2026-08-16).
  //
  // Until this existed the form recorded the address in opt_in_submissions and never
  // touched the member record, so a member updating their email through the form was
  // silently ignored — and the membership import would then offer to "correct" their
  // new address back to the stale one AdminSkiRacing held.

  it('takes the address from the form over the one on file', () => {
    const decided = resolveEmail({ email: 'old@example.com' }, { email: 'new@example.com' })
    expect(decided.email).toBe('new@example.com')
    expect(decided.changed).toBe(true)
    expect(decided.from).toBe('old@example.com')
  })

  it('reports no change when the two agree', () => {
    const decided = resolveEmail({ email: 'same@example.com' }, { email: 'same@example.com' })
    expect(decided.changed).toBe(false)
    expect(decided.from).toBeNull()
  })

  it('ignores case when comparing', () => {
    // Nobody has changed their address by capitalising it.
    const decided = resolveEmail({ email: 'Ada@Example.COM' }, { email: 'ada@example.com' })
    expect(decided.changed).toBe(false)
  })

  // Filling a blank is not replacing anything.
  it('fills a missing address without calling it a change', () => {
    const decided = resolveEmail({ email: null }, { email: 'new@example.com' })
    expect(decided.email).toBe('new@example.com')
    expect(decided.changed).toBe(false)
  })

  it('keeps what is on file when the form gives nothing', () => {
    const decided = resolveEmail({ email: 'ours@example.com' }, { email: '   ' })
    expect(decided.email).toBe('ours@example.com')
    expect(decided.changed).toBe(false)
  })

  it('never reports a from-address without reporting a change', () => {
    // The note written to the submission is built from `from`, so a stray value here
    // would record an address that never moved.
    const cases = [
      resolveEmail({ email: null }, { email: 'a@example.com' }),
      resolveEmail({ email: 'a@example.com' }, { email: '' }),
      resolveEmail({ email: 'a@example.com' }, { email: 'a@example.com' }),
    ]
    for (const c of cases) expect(c.from).toBeNull()
  })
})

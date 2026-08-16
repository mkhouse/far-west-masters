/**
 * Display formatting.
 *
 * Moved out of members.test.ts when formatPhone moved out of members.ts — that
 * module is marked `server-only`, and a client component legitimately needs to
 * render a phone number. See lib/format.ts.
 */

import { describe, expect, it } from 'vitest'
import { formatPhone } from './format'

describe('formatPhone', () => {
  it('makes an E.164 number readable', () => {
    expect(formatPhone('+15305551234')).toBe('(530) 555-1234')
  })

  it('shows a dash when there is no number', () => {
    expect(formatPhone(null)).toBe('—')
  })

  // Better to show something unexpected than to hide it: a number that does not fit
  // the pattern is exactly the one somebody needs to see in order to fix it.
  it('passes through anything that does not fit the pattern', () => {
    expect(formatPhone('+442079460958')).toBe('+442079460958')
    expect(formatPhone('5305551234')).toBe('5305551234')
  })
})

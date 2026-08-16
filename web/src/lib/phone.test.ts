/**
 * Phone normalisation.
 *
 * Everything downstream keys off the normalised number: the opt-in form matches a
 * submission to a member by it, the roster import matches by it, and Twilio needs
 * E.164 to send at all. A normalisation that is wrong in one direction loses a
 * member; wrong in the other, it matches the wrong person.
 */

import { describe, expect, it } from 'vitest'
import { phoneDigits, toE164 } from './phone'

describe('phoneDigits', () => {
  // The shapes actually found in the two roster exports.
  it.each([
    ['5305551234', 'bare digits'],
    ['(530) 555-1234', 'parentheses and a dash'],
    ['530-555-1234', 'dashes'],
    ['530.555.1234', 'dots'],
    ['530 555 1234', 'spaces'],
    ['+15305551234', 'E.164'],
    ['15305551234', 'a leading country code'],
    ['1 (530) 555-1234', 'a country code and punctuation'],
  ])('reduces %s (%s) to ten digits', (input) => {
    expect(phoneDigits(input)).toBe('5305551234')
  })

  it('returns an empty string for nothing at all', () => {
    expect(phoneDigits(null)).toBe('')
    expect(phoneDigits(undefined)).toBe('')
    expect(phoneDigits('')).toBe('')
    expect(phoneDigits('not a phone number')).toBe('')
  })

  // Only a leading 1 on an eleven-digit number is a country code. A leading 1 on a
  // ten-digit number is the area code, and stripping it would corrupt the number.
  it('does not mistake a leading 1 in an area code for a country code', () => {
    expect(phoneDigits('1305551234')).toBe('1305551234')
  })
})

describe('toE164', () => {
  it('formats a ten-digit number for Twilio', () => {
    expect(toE164('(530) 555-1234')).toBe('+15305551234')
  })

  it('is idempotent on a number already in E.164', () => {
    expect(toE164('+15305551234')).toBe('+15305551234')
  })

  // Refusing here is deliberate. Twilio would reject these too, but later and less
  // usefully — and a submission that fails to normalise is held for review rather
  // than dropped, so nobody is lost by it.
  it.each([
    ['530555123', 'nine digits — a typo'],
    ['53055512345', 'eleven digits that are not a US country code'],
    ['', 'empty'],
    ['no digits here', 'no digits at all'],
  ])('refuses %s (%s)', (input) => {
    expect(toE164(input)).toBeNull()
  })

  it('refuses null and undefined rather than throwing', () => {
    expect(toE164(null)).toBeNull()
    expect(toE164(undefined)).toBeNull()
  })

  it('refuses an international number, which needs a human to look at it', () => {
    // +44 20 7946 0958 — a valid number, but not one this club can send to.
    expect(toE164('+442079460958')).toBeNull()
  })
})

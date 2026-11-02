import { describe, expect, it } from 'vitest'
import { isUselessErrorMessage, signInErrorMessage } from './sign-in-errors'

describe('isUselessErrorMessage', () => {
  it('recognises the one that actually happened', () => {
    // 2 November 2026: the mailbox password changed, Supabase returned an error whose
    // message was the literal string "{}", and the sign-in page rendered a red "{}".
    expect(isUselessErrorMessage('{}')).toBe(true)
  })

  it('recognises the other ways nothing gets said', () => {
    for (const raw of ['', '   ', '[]', '[object Object]', 'null', 'undefined']) {
      expect(isUselessErrorMessage(raw), JSON.stringify(raw)).toBe(true)
    }
  })

  it('treats a missing message as useless', () => {
    expect(isUselessErrorMessage(null)).toBe(true)
    expect(isUselessErrorMessage(undefined)).toBe(true)
  })

  it('does not discard a message that says something', () => {
    for (const raw of [
      'Email rate limit exceeded',
      'For security purposes, you can only request this after 48 seconds.',
      '535 "5.7.8 Error: authentication failed: "',
    ]) {
      expect(isUselessErrorMessage(raw), raw).toBe(false)
    }
  })
})

describe('signInErrorMessage', () => {
  it('replaces an empty message with something a person can act on', () => {
    const message = signInErrorMessage('{}')
    expect(message).not.toBe('{}')
    expect(message).toMatch(/could not send/i)
    // Says whose problem it is. Somebody who has just typed their address should not
    // be left wondering whether they typed it wrong.
    expect(message).toMatch(/not with your address/i)
    // And where the real answer is kept.
    expect(message).toMatch(/RUNBOOK/)
  })

  it('passes through a message that is already useful', () => {
    // Rate limits are the common real error, and the wording is exactly what
    // somebody needs to read. Replacing it with something vaguer is a downgrade.
    expect(signInErrorMessage('Email rate limit exceeded')).toBe(
      'Email rate limit exceeded'
    )
  })

  it('trims, so whitespace does not read as a message', () => {
    expect(signInErrorMessage('  Email rate limit exceeded  ')).toBe(
      'Email rate limit exceeded'
    )
    expect(signInErrorMessage('   ')).toMatch(/could not send/i)
  })

  it('never returns an empty string', () => {
    for (const raw of [null, undefined, '', '{}', 'null']) {
      expect(signInErrorMessage(raw).length).toBeGreaterThan(0)
    }
  })
})

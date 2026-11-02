import { describe, expect, it } from 'vitest'
import { allowedOnOptInHost, isOptInHost } from './opt-in-host'

/**
 * What these pin down is an exposure boundary, not a convenience.
 *
 * Match too narrowly and members land on the officer sign-in instead of the consent
 * form — which is exactly what happened when this matched `optin.` as a prefix and
 * the club chose `fwm-messaging-optin`. Match too widely and a hostname that should
 * serve the application becomes form-only, or the reverse.
 */
describe('isOptInHost', () => {
  it('matches the hostname the club uses', () => {
    expect(isOptInHost('fwm-messaging-optin.mkinthehouse.com')).toBe(true)
  })

  it('still matches the original naming', () => {
    // Kept working deliberately: if `optin.mkinthehouse.com` is ever added, it
    // should behave the same way rather than quietly serving the whole app.
    expect(isOptInHost('optin.mkinthehouse.com')).toBe(true)
  })

  it('does NOT match the hostnames that serve the application', () => {
    // The regression that matters. If either of these ever matched, the officer
    // tooling would stop being reachable at its own address.
    expect(isOptInHost('fwm-results.mkinthehouse.com')).toBe(false)
    expect(isOptInHost('fwm-apps.mkinthehouse.com')).toBe(false)
    expect(isOptInHost('far-west-masters-web.vercel.app')).toBe(false)
  })

  it('only considers the leftmost label', () => {
    // The direction an attacker controls. A hostname must never qualify because of
    // something to the RIGHT of the first dot.
    expect(isOptInHost('evil.optin.example.com')).toBe(false)
    expect(isOptInHost('members.fwm-messaging-optin.example.com')).toBe(false)
  })

  it('does not match a label that merely contains optin', () => {
    // A git branch named `optin-anything` produces a preview host like this. Turning
    // that into a form-only deployment would be baffling to whoever did it.
    expect(isOptInHost('far-west-masters-web-git-optin-fix-abc123.vercel.app')).toBe(
      false
    )
  })

  it('does not match local development', () => {
    expect(isOptInHost('localhost:3000')).toBe(false)
    expect(isOptInHost('127.0.0.1:3000')).toBe(false)
  })

  it('is case-insensitive, because Host headers are', () => {
    expect(isOptInHost('FWM-Messaging-OptIn.MkInTheHouse.com')).toBe(true)
  })

  it('treats a missing Host header as not the opt-in host', () => {
    // Fail towards the application, which requires a sign-in, rather than towards
    // the public form.
    expect(isOptInHost(null)).toBe(false)
    expect(isOptInHost(undefined)).toBe(false)
    expect(isOptInHost('')).toBe(false)
  })
})

describe('allowedOnOptInHost', () => {
  it('allows the form and the assets it needs', () => {
    expect(allowedOnOptInHost('/')).toBe(true)
    expect(allowedOnOptInHost('/opt-in')).toBe(true)
    expect(allowedOnOptInHost('/_next/static/chunk.js')).toBe(true)
    expect(allowedOnOptInHost('/favicon.ico')).toBe(true)
  })

  it('does not allow the officer tooling', () => {
    for (const path of ['/members', '/messages', '/admin', '/process', '/account']) {
      expect(allowedOnOptInHost(path), path).toBe(false)
    }
  })

  it('does not allow a path that merely starts with an allowed one', () => {
    // `/opt-in-review` is not `/opt-in`, and `/_nextdoor` is not `/_next/`.
    expect(allowedOnOptInHost('/opt-in-review')).toBe(false)
    expect(allowedOnOptInHost('/_nextdoor')).toBe(false)
  })
})

/**
 * Segment calculator tests.
 *
 * SMS cost scales with recipients, so an off-by-one at a segment boundary is not a
 * cosmetic bug — it is hundreds of extra messages. These cases pin the boundaries
 * exactly, including the UCS-2 cliff that a single curly apostrophe triggers.
 *
 * Migrated from web/scripts/test-segments.ts when Vitest was adopted (#58). The
 * cases are unchanged; only the harness around them is different.
 */

import { describe, expect, it } from 'vitest'
import {
  additionsLength,
  analyseMessage,
  checkSendability,
  composeBody,
  countEmoji,
  fixSmartCharacters,
  remainingNonGsmCharacters,
} from './segments'

/** FWM's opt-out line, appended by the app to every message. See migration 0018. */
const OPT_OUT = 'Text STOP to stop'

/** Its cost: 17 characters plus the newline separating it from the message. */
const APPEND = OPT_OUT.length + 1

describe('segment boundaries (GSM-7, 18-char append)', () => {
  it('holds 142 characters in one segment', () => {
    expect(analyseMessage('a'.repeat(142), APPEND).segments).toBe(1)
  })

  it('tips into a second segment at 143', () => {
    expect(analyseMessage('a'.repeat(143), APPEND).segments).toBe(2)
  })

  it('holds 288 in two segments and tips at 289', () => {
    expect(analyseMessage('a'.repeat(288), APPEND).segments).toBe(2)
    expect(analyseMessage('a'.repeat(289), APPEND).segments).toBe(3)
  })

  it('holds 441 in three segments and tips at 442', () => {
    expect(analyseMessage('a'.repeat(441), APPEND).segments).toBe(3)
    expect(analyseMessage('a'.repeat(442), APPEND).segments).toBe(4)
  })
})

describe('the UCS-2 cliff', () => {
  it('is triggered by a curly apostrophe', () => {
    expect(analyseMessage('Don’t', APPEND).encoding).toBe('ucs2')
  })

  it('is not triggered by a plain apostrophe', () => {
    expect(analyseMessage("Don't", APPEND).encoding).toBe('gsm7')
  })

  it('cuts the first segment to 52 characters of body', () => {
    expect(analyseMessage('’' + 'a'.repeat(51), APPEND).segments).toBe(1)
    expect(analyseMessage('’' + 'a'.repeat(52), APPEND).segments).toBe(2)
  })
})

describe('GSM-7 extension characters', () => {
  it('cost two characters each without forcing UCS-2', () => {
    expect(analyseMessage('€'.repeat(40)).length).toBe(80)
    expect(analyseMessage('€'.repeat(40)).encoding).toBe('gsm7')
  })
})

describe('smart character fixes, applied automatically', () => {
  const fixed = fixSmartCharacters('Don’t “forget” — bib pickup…8am')

  it('replaces smart punctuation with plain equivalents', () => {
    expect(fixed.text).toBe('Don\'t "forget" - bib pickup...8am')
  })

  it('brings the message back into GSM-7', () => {
    expect(analyseMessage(fixed.text).encoding).toBe('gsm7')
  })

  it('reports each kind of replacement it made', () => {
    expect(fixed.replaced).toHaveLength(4)
  })

  it('is idempotent', () => {
    expect(fixSmartCharacters(fixed.text).changed).toBe(false)
  })
})

describe('emoji and accents are allowed, not stripped', () => {
  it('leaves emoji alone', () => {
    expect(fixSmartCharacters('Race day ⛷').text).toBe('Race day ⛷')
  })

  it('leaves accented member names alone', () => {
    expect(fixSmartCharacters('Café').text).toBe('Café')
  })

  it('lists what is outside GSM-7 so the budget can be explained', () => {
    expect(remainingNonGsmCharacters('start ⛷')).toEqual(['⛷'])
  })
})

describe('emoji counting', () => {
  it('counts emoji as a reader sees them', () => {
    expect(countEmoji('Race day! ⛷🎿')).toBe(2)
  })

  it('counts a multi-part emoji as one', () => {
    expect(countEmoji('👨‍👩‍👧')).toBe(1)
  })

  it('does not count typographic symbols as emoji', () => {
    expect(countEmoji('FWM© Racing™')).toBe(0)
  })

  // Budget cost depends on where the character sits in Unicode, not on whether it
  // reads as an emoji: skier is a single UTF-16 unit, ski is a surrogate pair.
  it('charges by UTF-16 length, not by how it reads', () => {
    expect(analyseMessage('⛷').length).toBe(1)
    expect(analyseMessage('🎿').length).toBe(2)
    expect(analyseMessage('⛷').encoding).toBe('ucs2')
  })
})

describe('send policy (warn above 2 segments, block above 3, block above 3 emoji)', () => {
  const opts = { appendedLength: APPEND }

  it('does not warn at two segments', () => {
    expect(checkSendability('a'.repeat(288), 287, opts).warn).toBe(false)
  })

  it('warns at three but still allows the send', () => {
    const verdict = checkSendability('a'.repeat(289), 287, opts)
    expect(verdict.warn).toBe(true)
    expect(verdict.blocked).toBe(false)
  })

  it('blocks at four segments', () => {
    expect(checkSendability('a'.repeat(442), 287, opts).blocked).toBe(true)
  })

  it('bills segments times recipients', () => {
    expect(checkSendability('a'.repeat(289), 287, opts).totalMessages).toBe(3 * 287)
  })

  it('allows three emoji and blocks four', () => {
    expect(checkSendability('Go! ⛷🎿🏔', 100).blocked).toBe(false)
    expect(checkSendability('Go! ⛷🎿🏔🥇', 100).blocked).toBe(true)
  })

  it('never blocks a message for containing an accent', () => {
    expect(checkSendability('Café at the lodge', 100).blocked).toBe(false)
  })
})

// The message as assembled here is the message that goes on the wire — send.ts and
// the composer both call composeBody. A mistake in this section is a mistake in what
// ~300 people receive.
describe('message assembly', () => {
  it('puts the opt-out line on its own line', () => {
    expect(composeBody('Bib pickup 8am', { optOutText: OPT_OUT })).toBe(
      'Bib pickup 8am\nText STOP to stop'
    )
  })

  it('puts the reply notice first and the opt-out last', () => {
    expect(
      composeBody('Bib pickup 8am', {
        replyNotice: 'Replies not monitored.',
        optOutText: OPT_OUT,
      })
    ).toBe('Bib pickup 8am Replies not monitored.\nText STOP to stop')
  })

  it('never appends the opt-out line twice', () => {
    expect(composeBody('Bib pickup 8am\nText STOP to stop', { optOutText: OPT_OUT })).toBe(
      'Bib pickup 8am\nText STOP to stop'
    )
  })

  it('ignores case when checking for a duplicate', () => {
    expect(composeBody('Bib pickup 8am. text stop to stop', { optOutText: OPT_OUT })).toBe(
      'Bib pickup 8am. text stop to stop'
    )
  })

  it('does not mistake an ordinary "stop" for the opt-out line', () => {
    expect(composeBody('We stop at the lodge', { optOutText: OPT_OUT })).toBe(
      'We stop at the lodge\nText STOP to stop'
    )
  })

  it('appends nothing when Twilio owns the opt-out line', () => {
    expect(composeBody('Bib pickup 8am', { optOutText: '' })).toBe('Bib pickup 8am')
  })

  it('trims the body', () => {
    expect(composeBody('  Bib pickup 8am  ', {})).toBe('Bib pickup 8am')
  })
})

describe('the budget matches what is actually sent', () => {
  it('charges for what the additions add', () => {
    expect(additionsLength('Bib pickup 8am', { optOutText: OPT_OUT })).toBe(APPEND)
  })

  it('counts the reply notice and the opt-out line together', () => {
    expect(
      additionsLength('Bib pickup 8am', {
        replyNotice: 'No replies.',
        optOutText: OPT_OUT,
      })
    ).toBe(APPEND + 'No replies.'.length + 1)
  })

  // The one that matters: nobody is charged for an opt-out line that will not be sent.
  it('charges nothing when the opt-out line is already in the body', () => {
    expect(
      additionsLength('Bib pickup 8am\nText STOP to stop', { optOutText: OPT_OUT })
    ).toBe(0)
  })

  it('agrees with the composed message, character for character', () => {
    const body = 'Bib pickup 8am'
    expect(composeBody(body, { optOutText: OPT_OUT }).length).toBe(
      body.length + additionsLength(body, { optOutText: OPT_OUT })
    )
  })
})

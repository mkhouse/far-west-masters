#!/usr/bin/env tsx
/**
 * Segment calculator tests.
 *
 * SMS cost scales with recipients, so an off-by-one at a segment boundary is not a
 * cosmetic bug — it is hundreds of extra messages. These cases pin the boundaries
 * exactly, including the UCS-2 cliff that a single curly apostrophe triggers.
 *
 *   npm run test:segments --workspace web
 */

import {
  additionsLength,
  analyseMessage,
  checkSendability,
  composeBody,
  countEmoji,
  fixSmartCharacters,
  remainingNonGsmCharacters,
} from '../src/lib/sms/segments.js'

/** FWM's opt-out line, appended by the app to every message. See migration 0018. */
const OPT_OUT = 'Text STOP to stop'

/** Its cost: 17 characters plus the newline separating it from the message. */
const APPEND = OPT_OUT.length + 1

let pass = 0
let fail = 0

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
      (ok ? '' : `  got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`)
  )
}

console.log('segment boundaries (GSM-7, 18-char append):')
check('142 body = 1 segment', analyseMessage('a'.repeat(142), APPEND).segments, 1)
check('143 body = 2 segments', analyseMessage('a'.repeat(143), APPEND).segments, 2)
check('288 body = 2 segments', analyseMessage('a'.repeat(288), APPEND).segments, 2)
check('289 body = 3 segments', analyseMessage('a'.repeat(289), APPEND).segments, 3)
check('441 body = 3 segments', analyseMessage('a'.repeat(441), APPEND).segments, 3)
check('442 body = 4 segments', analyseMessage('a'.repeat(442), APPEND).segments, 4)

console.log('\nUCS-2 cliff:')
check('curly apostrophe forces ucs2', analyseMessage('Don’t', APPEND).encoding, 'ucs2')
check('plain apostrophe stays gsm7', analyseMessage("Don't", APPEND).encoding, 'gsm7')
check('52 body = 1 segment (ucs2)', analyseMessage('’' + 'a'.repeat(51), APPEND).segments, 1)
check('53 body = 2 segments (ucs2)', analyseMessage('’' + 'a'.repeat(52), APPEND).segments, 2)

console.log('\nGSM-7 extension characters cost two:')
check('40 euro signs = 80 chars', analyseMessage('€'.repeat(40)).length, 80)
check('still gsm7', analyseMessage('€'.repeat(40)).encoding, 'gsm7')

console.log('\nsmart character fixes (applied automatically):')
const fixed = fixSmartCharacters('Don’t “forget” — bib pickup…8am')
check('cleaned text', fixed.text, 'Don\'t "forget" - bib pickup...8am')
check('now gsm7', analyseMessage(fixed.text).encoding, 'gsm7')
check('reports what changed', fixed.replaced.length, 4)
check('idempotent', fixSmartCharacters(fixed.text).changed, false)

console.log('\nemoji and accents are allowed, not stripped:')
check('emoji survives the fixer', fixSmartCharacters('Race day ⛷').text, 'Race day ⛷')
check('accents survive the fixer', fixSmartCharacters('Café').text, 'Café')
check('non-GSM characters are listed', remainingNonGsmCharacters('start ⛷'), ['⛷'])

console.log('\nemoji counting:')
check('counts simple emoji', countEmoji('Race day! ⛷🎿'), 2)
check('multi-part emoji counts as one', countEmoji('👨‍👩‍👧'), 1)
check('ignores © and ™', countEmoji('FWM© Racing™'), 0)
// Budget cost depends on where the character sits in Unicode, not on whether it
// reads as an emoji: ⛷ is a single UTF-16 unit, 🎿 is a surrogate pair costing two.
check('BMP emoji costs 1 character', analyseMessage('⛷').length, 1)
check('non-BMP emoji costs 2 characters', analyseMessage('🎿').length, 2)
check('both still force ucs2', analyseMessage('⛷').encoding, 'ucs2')

console.log('\npolicy (warn >2 segments, block >3 segments, block >3 emoji):')
check('2 segments: no warning', checkSendability('a'.repeat(288), 287, { appendedLength: APPEND }).warn, false)
check('3 segments: warns', checkSendability('a'.repeat(289), 287, { appendedLength: APPEND }).warn, true)
check('3 segments: allowed', checkSendability('a'.repeat(289), 287, { appendedLength: APPEND }).blocked, false)
check('4 segments: blocked', checkSendability('a'.repeat(442), 287, { appendedLength: APPEND }).blocked, true)
check(
  'cost is segments x recipients',
  checkSendability('a'.repeat(289), 287, { appendedLength: APPEND }).totalMessages,
  3 * 287
)
check('3 emoji allowed', checkSendability('Go! ⛷🎿🏔', 100).blocked, false)
check('4 emoji blocked', checkSendability('Go! ⛷🎿🏔🥇', 100).blocked, true)
check('accented text is allowed', checkSendability('Café at the lodge', 100).blocked, false)

// The message as assembled here is the message that goes on the wire — send.ts and
// the composer both call composeBody. A mistake in this section is a mistake in what
// ~300 people receive.
console.log('\nmessage assembly:')
check(
  'opt-out line appended on its own line',
  composeBody('Bib pickup 8am', { optOutText: OPT_OUT }),
  'Bib pickup 8am\nText STOP to stop'
)
check(
  'reply notice first, opt-out last',
  composeBody('Bib pickup 8am', {
    replyNotice: 'Replies not monitored.',
    optOutText: OPT_OUT,
  }),
  'Bib pickup 8am Replies not monitored.\nText STOP to stop'
)
check(
  'never appended twice',
  composeBody('Bib pickup 8am\nText STOP to stop', { optOutText: OPT_OUT }),
  'Bib pickup 8am\nText STOP to stop'
)
check(
  'duplicate check ignores case',
  composeBody('Bib pickup 8am. text stop to stop', { optOutText: OPT_OUT }),
  'Bib pickup 8am. text stop to stop'
)
check(
  'an ordinary "stop" is not mistaken for the opt-out line',
  composeBody('We stop at the lodge', { optOutText: OPT_OUT }),
  'We stop at the lodge\nText STOP to stop'
)
check(
  'nothing appended when Twilio owns the opt-out line',
  composeBody('Bib pickup 8am', { optOutText: '' }),
  'Bib pickup 8am'
)
check('body is trimmed', composeBody('  Bib pickup 8am  ', {}), 'Bib pickup 8am')

console.log('\nthe budget matches what is actually sent:')
check(
  'additions cost what they add',
  additionsLength('Bib pickup 8am', { optOutText: OPT_OUT }),
  APPEND
)
check(
  'notice and opt-out both counted',
  additionsLength('Bib pickup 8am', { replyNotice: 'No replies.', optOutText: OPT_OUT }),
  APPEND + 'No replies.'.length + 1
)
// The one that matters: nobody is charged for an opt-out line that will not be sent.
check(
  'no charge when the opt-out line is already there',
  additionsLength('Bib pickup 8am\nText STOP to stop', { optOutText: OPT_OUT }),
  0
)
check(
  'composed length equals body plus additions',
  composeBody('Bib pickup 8am', { optOutText: OPT_OUT }).length,
  'Bib pickup 8am'.length + additionsLength('Bib pickup 8am', { optOutText: OPT_OUT })
)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

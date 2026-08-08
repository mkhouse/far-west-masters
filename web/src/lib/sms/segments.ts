/**
 * SMS length, encoding, and segment counting.
 *
 * SMS is billed per *segment*, multiplied by every recipient. At ~300 members one
 * careless character can cost 300 extra messages, so this needs to be right rather
 * than approximately right.
 *
 * See migration/sms-limits.md for the rules this implements and where they came from.
 */

/**
 * The GSM 03.38 basic character set. Anything outside this (plus the extension
 * table below) forces the whole message into UCS-2, dropping the limit from 160
 * characters to 70.
 */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

/**
 * GSM-7 extension characters. These are encodable, but each one costs **two**
 * characters of the budget rather than one, because it is sent as an escape
 * sequence.
 */
const GSM7_EXTENDED = '^{}\\[~]|€'

const BASIC = new Set(GSM7_BASIC)
const EXTENDED = new Set(GSM7_EXTENDED)

/** Segment sizes, per the GSM and UCS-2 specifications. */
const LIMITS = {
  // A message that fits in one segment gets the full payload.
  gsm7: { single: 160, concatenated: 153 },
  // Concatenated messages give up space to a header that says how they reassemble.
  ucs2: { single: 70, concatenated: 67 },
} as const

export type SmsEncoding = 'gsm7' | 'ucs2'

/**
 * Characters that look ordinary but force UCS-2, mapped to safe equivalents.
 *
 * These matter more than they appear to. Word processors, Google Docs, Notes and
 * iOS keyboards all insert them automatically, so a message drafted anywhere other
 * than the compose box will usually contain at least one — and it is invisible.
 * A message that reads identically can cost twice as much to send.
 */
const SMART_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/[‘’‚‛]/g, "'", 'curly apostrophe'],
  [/[“”„‟]/g, '"', 'curly quotation marks'],
  [/[–—―]/g, '-', 'en/em dash'],
  [/…/g, '...', 'ellipsis'],
  [/ /g, ' ', 'non-breaking space'],
  [/[′‵]/g, "'", 'prime mark'],
  [/•/g, '*', 'bullet'],
  [/[«»]/g, '"', 'guillemet'],
]

/** Can this text be sent as GSM-7, or does it force UCS-2? */
export function detectEncoding(text: string): SmsEncoding {
  for (const char of text) {
    if (!BASIC.has(char) && !EXTENDED.has(char)) return 'ucs2'
  }
  return 'gsm7'
}

/**
 * Billable character count.
 *
 * In GSM-7 the extension characters cost two each, so this is not the same as
 * `text.length`. In UCS-2 characters outside the Basic Multilingual Plane (emoji,
 * mostly) are surrogate pairs and also cost two — which `text.length` already
 * reflects, since JavaScript strings are UTF-16.
 */
export function billableLength(text: string, encoding: SmsEncoding): number {
  if (encoding === 'ucs2') return text.length
  let n = 0
  for (const char of text) n += EXTENDED.has(char) ? 2 : 1
  return n
}

export interface SegmentInfo {
  encoding: SmsEncoding
  /** Billable characters, including anything appended */
  length: number
  segments: number
  /** Characters still available before another segment is needed */
  remainingInSegment: number
  /** True when a non-GSM-7 character has collapsed the limit from 160 to 70 */
  forcedUcs2: boolean
}

/**
 * Work out how a message will actually be sent.
 *
 * @param body           What the sender typed
 * @param appendedLength Characters added after the app hands the message over —
 *                       Twilio's opt-out text, plus any reply notice. These are
 *                       invisible to the sender but count against every segment,
 *                       so omitting them under-counts the cost.
 */
export function analyseMessage(body: string, appendedLength = 0): SegmentInfo {
  const encoding = detectEncoding(body)
  const length = billableLength(body, encoding) + appendedLength
  const limits = LIMITS[encoding]

  let segments: number
  if (length === 0) {
    segments = 0
  } else if (length <= limits.single) {
    segments = 1
  } else {
    segments = Math.ceil(length / limits.concatenated)
  }

  const capacity =
    segments <= 1 ? limits.single : segments * limits.concatenated

  return {
    encoding,
    length,
    segments,
    remainingInSegment: Math.max(0, capacity - length),
    forcedUcs2: encoding === 'ucs2',
  }
}

export interface SmartCharacterFix {
  /** The cleaned text */
  text: string
  /** Human-readable names of what was replaced, for showing the sender */
  replaced: string[]
  changed: boolean
}

/**
 * Replace characters that force UCS-2 with plain equivalents.
 *
 * **Applied automatically as the sender types or pastes**, so the compose box shows
 * exactly what will be sent. Nothing is altered behind the sender's back — the
 * correction happens in front of them, the way a spellchecker works. A prompt would
 * be worse: the offending character is invisible, so "we found a problem, fix it
 * yourself" is not actionable.
 *
 * Safe to apply without asking because every replacement is punctuation, visually
 * near-identical, and never touches letters. Accented characters that GSM-7 already
 * supports (é ü ñ ö à ä å æ ß Ç Ø) are left alone, so member names are never
 * rewritten.
 *
 * Note `…` becomes `...`, which makes the message two characters *longer*. That is
 * still worth doing: an ellipsis forces UCS-2, cutting the per-segment limit from
 * 160 to 70, so two extra characters buy back more than double the budget.
 *
 * Idempotent — running it twice changes nothing further.
 *
 * `replaced` is returned so the UI can note what happened, quietly. Characters that
 * cannot be substituted without changing meaning — emoji, uncommon accents — are
 * left in place and surfaced by remainingNonGsmCharacters() instead.
 */
export function fixSmartCharacters(text: string): SmartCharacterFix {
  let out = text
  const replaced: string[] = []

  for (const [pattern, replacement, label] of SMART_REPLACEMENTS) {
    if (pattern.test(out)) {
      replaced.push(label)
      out = out.replace(pattern, replacement)
    }
    pattern.lastIndex = 0 // these are /g regexes, reused across calls
  }

  return { text: out, replaced, changed: out !== text }
}

/**
 * Characters outside GSM-7 that were deliberately left alone — emoji and accented
 * letters we cannot substitute without changing meaning.
 *
 * These are **allowed**. The list exists so the compose screen can explain *why* the
 * character budget shrank, not to flag an error. Stripping the accent from a
 * member's name to save characters would be worse than sending a shorter message.
 */
export function remainingNonGsmCharacters(text: string): string[] {
  const found = new Set<string>()
  for (const char of text) {
    if (!BASIC.has(char) && !EXTENDED.has(char)) found.add(char)
  }
  return [...found]
}

/**
 * Count emoji in a message.
 *
 * Counts by grapheme cluster, not code unit, so a multi-part emoji like a family or
 * a flag counts as one thing the way a reader sees it — even though it may occupy
 * six or more characters of the budget.
 *
 * That distinction matters: the cap is about tone and readability, while the budget
 * is about cost. They are different concerns and should not share a number.
 */
export function countEmoji(text: string): number {
  const graphemes =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map(
          (s) => s.segment
        )
      : [...text]

  const pictographic = /\p{Extended_Pictographic}/u

  // Unicode classifies these as Extended_Pictographic, but nobody writing "FWM©"
  // means it as an emoji, and counting it against the cap would be baffling. They
  // still cost budget by forcing UCS-2 — that is reported separately.
  const typographicSymbols = /[©®™℠℗]/

  return graphemes.filter((g) => pictographic.test(g) && !typographicSymbols.test(g))
    .length
}

export interface SendabilityVerdict {
  info: SegmentInfo
  /** Total messages billed: segments x recipients */
  totalMessages: number
  /** Emoji found, counted as a reader sees them */
  emojiCount: number
  /** Over the warning threshold but still allowed */
  warn: boolean
  /** Over a hard limit — refuse to send */
  blocked: boolean
  reason: string | null
}

/**
 * Decide whether a message may be sent, given FWM's policy.
 *
 * FWM messages routinely run to two or three segments and that is accepted. The
 * warning marks where cost is worth a second look; the block is the guard rail
 * against a message quietly costing several times what was intended.
 *
 * Thresholds come from `app_settings` so an admin can change them without a deploy.
 */
export function checkSendability(
  body: string,
  recipients: number,
  opts: {
    appendedLength?: number
    warnSegments?: number
    maxSegments?: number
    maxEmoji?: number
  } = {}
): SendabilityVerdict {
  const {
    appendedLength = 0,
    warnSegments = 2,
    maxSegments = 3,
    maxEmoji = 3,
  } = opts

  const info = analyseMessage(body, appendedLength)
  const totalMessages = info.segments * recipients
  const emojiCount = countEmoji(body)
  const base = { info, totalMessages, emojiCount }

  // Emoji and accents are allowed. The cap is about tone, not encoding — a message
  // with three emoji reads as friendly, one with fifteen reads as spam, and carriers
  // take a dim view of the latter.
  if (emojiCount > maxEmoji) {
    return {
      ...base,
      warn: false,
      blocked: true,
      reason: `${emojiCount} emoji; the limit is ${maxEmoji}. Remove ${emojiCount - maxEmoji}.`,
    }
  }

  if (info.segments > maxSegments) {
    // Explain *why* the budget is small when it is not obvious. An emoji or accent
    // costs far more than it looks like it should, and the sender deserves to know
    // that rather than being told to "shorten it" with no explanation.
    const cause = info.forcedUcs2
      ? ` A special character (${remainingNonGsmCharacters(body).slice(0, 4).join(' ')}) reduces the limit from 160 to 70 characters per segment.`
      : ''
    const over = info.length - maxSegments * LIMITS[info.encoding].concatenated

    return {
      ...base,
      warn: false,
      blocked: true,
      reason:
        `This message is ${info.segments} segments; the limit is ${maxSegments}. ` +
        `Shorten it by about ${over} characters.${cause}`,
    }
  }

  if (info.segments > warnSegments) {
    return {
      ...base,
      warn: true,
      blocked: false,
      reason: `${info.segments} segments × ${recipients} recipients = ${totalMessages} messages.`,
    }
  }

  return { ...base, warn: false, blocked: false, reason: null }
}

/** Everything the app adds to a message after the sender stops typing. */
export interface MessageAdditions {
  /** Shown when nobody is watching for replies. Omitted when they are. */
  replyNotice?: string | null
  /** FWM's opt-out line. Empty only if Twilio is configured to append its own. */
  optOutText?: string | null
}

/**
 * Assemble the message exactly as it will arrive on a phone.
 *
 * This lives beside the segment counter on purpose. The expensive bug in an SMS
 * system is not a miscount — it is the counter and the composer disagreeing, so that
 * what is measured is not what is sent. Both are built from this one function, so
 * they cannot drift.
 *
 * Order matches how FWM's messages have always read: the message, then the reply
 * notice if replies are not being watched, then the opt-out line last on its own
 * line.
 */
export function composeBody(body: string, additions: MessageAdditions = {}): string {
  const { replyNotice, optOutText } = additions

  let text = body.trim()
  if (replyNotice?.trim()) text += ` ${replyNotice.trim()}`

  // Never twice. A sender who has typed the opt-out line themselves — or pasted an
  // old message that already carries it — should not send it to members doubled.
  const optOut = optOutText?.trim()
  if (optOut && !text.toLowerCase().includes(optOut.toLowerCase())) {
    text += `\n${optOut}`
  }

  return text
}

/**
 * How many characters the additions cost, for the segment budget.
 *
 * Measured by composing the message and subtracting, rather than adding up lengths
 * separately — so the duplicate-suppression above is reflected in the count for
 * free. A sender whose message already contains the opt-out line is not charged for
 * it twice in the composer either.
 */
export function additionsLength(body: string, additions: MessageAdditions = {}): number {
  return composeBody(body, additions).length - body.trim().length
}

/**
 * Message templates: the placeholders, and how they are filled.
 *
 * A template is text with blanks. That is not decoration — it is the whole reason
 * these are stored centrally rather than retyped. Every message FWM sends to a member
 * opens with their first name, and most identify the officer sending it, so fixed
 * wording would be wrong for either the member or the officer on every use. See
 * docs/message-templates.md.
 *
 * Deliberately NOT marked `server-only`, unlike most of lib/ — same reasoning as
 * format.ts and phone.ts. There is no key, request or database here, only string
 * handling, and the compose box is a client component that has to fill a template and
 * check what is left over as the officer types. Marking this server-only would force
 * a second copy into the browser bundle, and two copies of a substitution rule is
 * exactly how the preview starts disagreeing with what gets sent.
 *
 * THE RULE THAT MATTERS: an unfilled placeholder is left in the text, verbatim, and
 * reported. It is never blanked and never guessed at. "Please give me a call at
 * {officer phone}" with no number on file must not become "Please give me a call at"
 * — a message that reads as finished but silently lost its point. Leaving the braces
 * in place makes the gap visible on screen, and both the compose screen and the send
 * action refuse to send a body that still contains one.
 */

/** Where the value for a placeholder comes from. */
export type PlaceholderSource =
  /** The signed-in officer — filled automatically, the same for every recipient. */
  | 'officer'
  /** The member being contacted — different for every recipient. */
  | 'member'
  /**
   * Chosen from the races left in the current season.
   *
   * A picker rather than a text box because three officers typing the same resort
   * produce "Palisades Tahoe", "Palisades" and "Squaw" in three texts about one race.
   * The schedule has no admin screen yet (#6), so the list can legitimately be empty
   * — every consumer of this falls back to free text rather than blocking the send.
   */
  | 'race'
  /** Typed by the officer for this send. */
  | 'typed'

export interface PlaceholderSpec {
  source: PlaceholderSource
  /** Shown beside the field or in the editor's help, so the list is self-explaining. */
  description: string
}

/**
 * Every placeholder that may appear in a template body.
 *
 * This object is the authority. Anything else between braces is rejected by the
 * editor rather than saved, because the alternative is a member receiving a text
 * containing the literal characters `{race director}` — and finding that out from
 * the member.
 *
 * Names are lower case with spaces, matching how they read in the message. Matching
 * is case- and whitespace-insensitive, so `{First Name}` and `{ first name }` both
 * work; someone typing a template should not have to think about it.
 */
export const PLACEHOLDERS: Record<string, PlaceholderSpec> = {
  'first name': {
    source: 'member',
    description: 'The first name of the member being contacted.',
  },
  'officer name': {
    source: 'officer',
    description:
      'Your first name. Templates are shared, so this cannot be typed into the wording.',
  },
  'officer phone': {
    source: 'officer',
    description:
      'The number you are willing to give to members. Set it at /account — it is ' +
      'deliberately not the number the club texts you on.',
  },
  venue: {
    source: 'race',
    description: 'The race this message is about. Pick it from the season schedule.',
  },
  'next venue': {
    source: 'race',
    description:
      'A second race, for messages offering a choice of two — "racing at X next ' +
      'weekend? Or Y the following weekend?"',
  },
  time: {
    // Stays typed. `races` records a date but no start time, so there is nothing to
    // pick from; "meet me between 7:30-8:30" is a bib-pickup window Mary sets, not a
    // property of the race. It becomes a picker the day the schedule holds times.
    source: 'typed',
    description: 'A time or a window, e.g. 7:30-8:30.',
  },
}

/** The five kinds, matching the `template_category` enum in migration 0028. */
export const TEMPLATE_CATEGORIES = [
  { value: 'new_member', label: 'New member welcome' },
  { value: 'race_logistics', label: 'Race-day logistics' },
  { value: 'action_required', label: 'Action required before race day' },
  { value: 're_engagement', label: 'Re-engagement' },
  { value: 'question', label: 'Answering a question' },
] as const

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]['value']

export function categoryLabel(value: string): string {
  return TEMPLATE_CATEGORIES.find((c) => c.value === value)?.label ?? value
}

export interface MessageTemplate {
  id: string
  name: string
  category: TemplateCategory
  body: string
}

/**
 * Anything between braces.
 *
 * `[^{}]*` rather than `.*` so an unclosed brace cannot swallow the rest of the
 * message and report one enormous placeholder. It is also what makes a stray `{` in
 * ordinary prose harmless — it simply never matches.
 */
const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g

/** Trim and casefold, so `{ First Name }` and `{first name}` are the same blank. */
function normalise(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Every placeholder in the body, normalised, in the order they first appear.
 *
 * Includes unrecognised ones. A caller asking "what blanks are in here" needs to be
 * told about `{race director}` too — that is precisely the case worth catching.
 */
export function findPlaceholders(body: string): string[] {
  const found: string[] = []
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = normalise(match[1])
    if (!found.includes(name)) found.push(name)
  }
  return found
}

/** Placeholders that are not in PLACEHOLDERS. Empty means the template is valid. */
export function unknownPlaceholders(body: string): string[] {
  return findPlaceholders(body).filter((name) => !(name in PLACEHOLDERS))
}

/**
 * Does this template need something only the recipient can supply?
 *
 * The compose screen uses this to keep `{first name}` out of a bulk send. There is no
 * per-recipient rendering in the sender — one body goes to everybody — so a template
 * addressing somebody by name can only be used one-to-one. Saying so is better than
 * building per-recipient substitution nobody asked for, and far better than texting
 * three hundred people "Hello {first name}".
 */
export function hasPerMemberPlaceholder(body: string): boolean {
  return findPlaceholders(body).some(
    (name) => PLACEHOLDERS[name]?.source === 'member'
  )
}

export interface FilledTemplate {
  /** The message, with everything that could be filled, filled. */
  text: string
  /** Placeholders still present, normalised. Non-empty means it must not be sent. */
  unresolved: string[]
}

/**
 * Fill what we can and report what we cannot.
 *
 * Substitution happens in ONE pass, via a replace callback, rather than a loop of
 * `replaceAll` per placeholder. That is not a micro-optimisation — a sequential loop
 * would re-scan text it has already written, so a member whose name contained
 * `{venue}` would have it filled by a later pass. One pass means a filled value is
 * final, and nothing an officer or a member can type finds its way into the
 * substitution rules.
 *
 * An empty or whitespace-only value counts as ABSENT, not as "fill it with nothing".
 * This is the case that matters: an officer with no contact number on file gets
 * `{officer phone}` left visibly in the message and a refusal to send, rather than a
 * cheerful "Please give me a call at ".
 */
export function fillTemplate(
  body: string,
  values: Record<string, string | null | undefined>
): FilledTemplate {
  // Normalise the caller's keys too, so `{ Officer Name }` finds `officerName`-ish
  // spellings from a form without every caller having to be careful.
  const supplied = new Map<string, string>()
  for (const [key, value] of Object.entries(values)) {
    const trimmed = String(value ?? '').trim()
    if (trimmed) supplied.set(normalise(key), trimmed)
  }

  const text = body.replace(PLACEHOLDER_PATTERN, (whole, inner: string) => {
    const name = normalise(inner)
    // Unknown placeholders are left exactly as written, not dropped. They are a
    // mistake in the template, and the officer needs to see the mistake.
    if (!(name in PLACEHOLDERS)) return whole
    return supplied.get(name) ?? whole
  })

  return { text, unresolved: findPlaceholders(text) }
}

/**
 * Put the placeholders back into a message that has already been filled in.
 *
 * The reverse of fillTemplate, for saving a message you are about to send as a
 * template. It is not a convenience — it is the thing that makes that feature safe.
 *
 * By the time an officer decides a message is worth keeping, it reads "Hello Damian,
 * this is Mary from FWM membership, call me at (530) 555-1234". Stored as written,
 * that template greets every future member as Damian and hands out Mary's mobile to
 * all of them — the precise failure the placeholders were introduced to prevent, and
 * it would arrive through the feature that looks most helpful.
 *
 * Longest values are substituted first, so a member called "Ann" cannot be matched
 * inside "Anna" or inside the officer's own name. Matching is case-sensitive and
 * bounded by word edges for names; the phone number is matched literally, because it
 * is formatted by us and will appear exactly as it was inserted.
 *
 * Everything else is left alone. A venue typed by hand is not converted unless it was
 * one of the supplied values — guessing that "Sugar Bowl" in the middle of a sentence
 * is a placeholder rather than the subject of the message would rewrite meaning.
 */
export function unfillTemplate(
  text: string,
  values: Record<string, string | null | undefined>
): string {
  const entries = Object.entries(values)
    .map(([name, value]) => [normalise(name), String(value ?? '').trim()] as const)
    .filter(([name, value]) => value.length > 0 && name in PLACEHOLDERS)
    // Longest first: "Mary Smith" must be replaced before "Mary", or the surname is
    // orphaned and left in the template.
    .sort((a, b) => b[1].length - a[1].length)

  let out = text

  for (const [name, value] of entries) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // A word boundary only where the value starts and ends with a word character —
    // "(530) 555-1234" begins with a bracket, and \b before it would never match.
    const left = /^\w/.test(value) ? '\\b' : ''
    const right = /\w$/.test(value) ? '\\b' : ''
    out = out.replace(new RegExp(`${left}${escaped}${right}`, 'g'), `{${name}}`)
  }

  return out
}

/**
 * A one-line summary of what a template still needs, for the editor and the picker.
 *
 * Reads as "needs a venue and a time" rather than listing brace syntax, because the
 * officer choosing a template is thinking about the message, not the markup.
 */
export function describePlaceholders(names: string[]): string {
  if (names.length === 0) return 'Nothing to fill in.'
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `Needs ${list}.`
}

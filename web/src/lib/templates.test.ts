import { describe, expect, it } from 'vitest'
import {
  PLACEHOLDERS,
  categoryLabel,
  describePlaceholders,
  fillTemplate,
  findPlaceholders,
  hasPerMemberPlaceholder,
  unfillTemplate,
  unknownPlaceholders,
} from './templates'

/**
 * The real templates, as seeded by migration 0029. Kept here verbatim so that a change
 * to the placeholder rules is checked against what FWM actually sends rather than
 * against invented examples.
 */
const NEW_MEMBER_WELCOME =
  'Hello {first name}, this is {officer name} from Far West Masters membership ' +
  'checking in with you as a new member. Please give me a call at {officer phone}'

const COURSE_INSPECTION =
  'Usually there is course inspection shortly after the lifts open (need to take two ' +
  'lifts to get to the start of the {venue} race course).'

const CHECKING_IN =
  'Hope all is well with you. This is {officer name} from FWM membership checking in ' +
  'with you. Any thoughts about racing at {venue} next weekend? Or {next venue} the ' +
  'following weekend?'

describe('findPlaceholders', () => {
  it('finds each blank once, in the order it first appears', () => {
    expect(findPlaceholders(NEW_MEMBER_WELCOME)).toEqual([
      'first name',
      'officer name',
      'officer phone',
    ])
  })

  it('treats case and inner whitespace as the same blank', () => {
    expect(findPlaceholders('{First Name} and { first  name }')).toEqual(['first name'])
  })

  it('returns nothing for a message with no blanks', () => {
    expect(findPlaceholders('Sugar Bowl SL starts at 9am.')).toEqual([])
  })

  it('ignores a stray brace rather than swallowing the rest of the message', () => {
    // `[^{}]*` is what makes this safe. A greedy `.*` would report one placeholder
    // running to the end of the text and hide everything after it.
    expect(findPlaceholders('Meet at 9 { and bring a helmet')).toEqual([])
  })
})

describe('unknownPlaceholders', () => {
  it('accepts every placeholder the real templates use', () => {
    for (const body of [NEW_MEMBER_WELCOME, COURSE_INSPECTION, CHECKING_IN]) {
      expect(unknownPlaceholders(body)).toEqual([])
    }
  })

  it('reports one nothing can fill', () => {
    expect(unknownPlaceholders('Ask {race director} about it')).toEqual([
      'race director',
    ])
  })
})

describe('fillTemplate', () => {
  it('fills what it is given and reports nothing left', () => {
    const { text, unresolved } = fillTemplate(COURSE_INSPECTION, {
      venue: 'Sugar Bowl',
    })
    expect(text).toContain('the Sugar Bowl race course')
    expect(unresolved).toEqual([])
  })

  it('leaves an unfilled blank in the text, visibly, and reports it', () => {
    // The property the whole feature rests on. A member must never receive "Please
    // give me a call at" with the number silently dropped.
    const { text, unresolved } = fillTemplate(NEW_MEMBER_WELCOME, {
      'first name': 'Damian',
      'officer name': 'Mary',
    })

    expect(text).toContain('Hello Damian')
    expect(text).toContain('this is Mary from')
    expect(text).toContain('call at {officer phone}')
    expect(unresolved).toEqual(['officer phone'])
  })

  it('treats an empty or whitespace-only value as absent, not as an empty fill', () => {
    // An officer with no contact number on file. Filling with '' would produce a
    // message that reads as finished and has lost its point.
    const { text, unresolved } = fillTemplate(NEW_MEMBER_WELCOME, {
      'first name': 'Damian',
      'officer name': 'Mary',
      'officer phone': '   ',
    })

    expect(text).toContain('call at {officer phone}')
    expect(unresolved).toEqual(['officer phone'])
  })

  it('fills the two venues in the re-engagement message independently', () => {
    // Migration 0029 splits these deliberately. One placeholder filled once would
    // offer the same resort as both options and turn an opening into nonsense.
    const { text, unresolved } = fillTemplate(CHECKING_IN, {
      'officer name': 'Mary',
      venue: 'Sugar Bowl',
      'next venue': 'Palisades Tahoe',
    })

    expect(text).toContain('racing at Sugar Bowl next weekend')
    expect(text).toContain('Or Palisades Tahoe the following weekend')
    expect(unresolved).toEqual([])
  })

  it('matches placeholders case-insensitively', () => {
    const { text } = fillTemplate('Hi {First Name}', { 'first name': 'Damian' })
    expect(text).toBe('Hi Damian')
  })

  it('never lets a filled value be re-read as a placeholder', () => {
    // One pass, not a loop of replaceAll. A member whose name contained {venue} would
    // otherwise have it substituted by a later pass — and more generally, nothing a
    // member or officer types should be able to reach the substitution rules.
    const { text, unresolved } = fillTemplate('Hi {first name}, see you at {venue}', {
      'first name': '{venue}',
      venue: 'Sugar Bowl',
    })

    expect(text).toBe('Hi {venue}, see you at Sugar Bowl')
    // The leftover is what the member typed as their name, reported so the officer
    // sees it rather than it going out silently.
    expect(unresolved).toEqual(['venue'])
  })

  it('leaves an unknown placeholder exactly as written', () => {
    const { text, unresolved } = fillTemplate('Ask {race director}', {
      'race director': 'Mary',
    })

    expect(text).toBe('Ask {race director}')
    expect(unresolved).toEqual(['race director'])
  })

  it('changes nothing in a template with no blanks', () => {
    const plain = 'Sugar Bowl SL starts at 9am.'
    expect(fillTemplate(plain, { venue: 'Alpine' })).toEqual({
      text: plain,
      unresolved: [],
    })
  })
})

describe('unfillTemplate', () => {
  // Saving a message you just sent as a template. By that point it reads "Hello
  // Damian, this is Mary, call me at (530) 555-1234" — stored as written, it greets
  // every future member as Damian and hands out Mary's mobile to all of them.
  const sent =
    'Hello Damian, this is Mary from Far West Masters membership checking in with ' +
    'you as a new member. Please give me a call at (530) 555-1234'

  const values = {
    'first name': 'Damian',
    'officer name': 'Mary',
    'officer phone': '(530) 555-1234',
  }

  it('puts the blanks back', () => {
    expect(unfillTemplate(sent, values)).toBe(NEW_MEMBER_WELCOME)
  })

  it('removes the officer’s phone number, which is the one that must not persist', () => {
    const result = unfillTemplate(sent, values)
    expect(result).not.toContain('555-1234')
    expect(result).toContain('{officer phone}')
  })

  it('round-trips: filling the result reproduces the original message', () => {
    const { text } = fillTemplate(unfillTemplate(sent, values), values)
    expect(text).toBe(sent)
  })

  it('replaces the longest value first, so a name is not left half-converted', () => {
    // 'Mary' inside 'Mary Smith' would otherwise produce '{officer name} Smith'.
    expect(
      unfillTemplate('This is Mary Smith from FWM', { 'officer name': 'Mary Smith' })
    ).toBe('This is {officer name} from FWM')
  })

  it('does not match a value inside a longer word', () => {
    // A member called Ann must not turn 'Anna' into '{first name}a'.
    expect(unfillTemplate('Hello Anna and Ann', { 'first name': 'Ann' })).toBe(
      'Hello Anna and {first name}'
    )
  })

  it('leaves placeholders that are already in the message alone', () => {
    // The ordinary case once the insert-a-blank control exists: the officer wrote
    // the message with blanks in it and never filled them.
    expect(unfillTemplate(NEW_MEMBER_WELCOME, values)).toBe(NEW_MEMBER_WELCOME)
  })

  it('ignores values it was given that do not appear', () => {
    expect(unfillTemplate('Race at Sugar Bowl', { 'first name': 'Damian' })).toBe(
      'Race at Sugar Bowl'
    )
  })

  it('ignores empty values rather than replacing everything', () => {
    // An officer with no contact number on file. An empty string as a search term
    // would otherwise match at every position in the message.
    expect(unfillTemplate('Call me at (530) 555-1234', { 'officer phone': '' })).toBe(
      'Call me at (530) 555-1234'
    )
  })

  it('ignores a name that is not a real placeholder', () => {
    expect(unfillTemplate('Ask the race director', { 'race director': 'Mike' })).toBe(
      'Ask the race director'
    )
  })

  it('treats a value containing regex characters literally', () => {
    // A phone number is full of brackets and dashes. Interpreted as a pattern rather
    // than text, this either throws or matches the wrong thing.
    expect(
      unfillTemplate('Call (530) 555-1234 today', { 'officer phone': '(530) 555-1234' })
    ).toBe('Call {officer phone} today')
  })
})

describe('hasPerMemberPlaceholder', () => {
  it('is true for a message that addresses somebody by name', () => {
    expect(hasPerMemberPlaceholder(NEW_MEMBER_WELCOME)).toBe(true)
  })

  it('is false for one that does not', () => {
    // Not every template needs a name. The course-inspection message answers a
    // question rather than opening a conversation, and the editor must not insist.
    expect(hasPerMemberPlaceholder(COURSE_INSPECTION)).toBe(false)
  })

  it('is false once the name has been filled in', () => {
    const { text } = fillTemplate(NEW_MEMBER_WELCOME, { 'first name': 'Damian' })
    expect(hasPerMemberPlaceholder(text)).toBe(false)
  })
})

describe('the placeholder set', () => {
  it('sources each placeholder from somewhere the compose screen can reach', () => {
    // A placeholder with no source is one nothing knows how to fill, which would
    // present as a send that can never be unblocked.
    for (const [name, spec] of Object.entries(PLACEHOLDERS)) {
      expect(['officer', 'member', 'race', 'typed'], name).toContain(spec.source)
      expect(spec.description.length, name).toBeGreaterThan(0)
    }
  })

  it('keeps the officer phone separate from anything on the member record', () => {
    // Guards the decision in migration 0030 rather than its implementation: if a
    // future edit made this fillable from the member being contacted, a template
    // would hand out the wrong person's number entirely.
    expect(PLACEHOLDERS['officer phone'].source).toBe('officer')
  })
})

describe('describePlaceholders', () => {
  it('says so when there is nothing to fill', () => {
    expect(describePlaceholders([])).toBe('Nothing to fill in.')
  })

  it('reads as a sentence for one, two and three', () => {
    expect(describePlaceholders(['{venue}'])).toBe('Needs {venue}.')
    expect(describePlaceholders(['{venue}', '{time}'])).toBe('Needs {venue} and {time}.')
    expect(describePlaceholders(['{a}', '{b}', '{c}'])).toBe('Needs {a}, {b} and {c}.')
  })
})

describe('categoryLabel', () => {
  it('names each of the five kinds', () => {
    expect(categoryLabel('new_member')).toBe('New member welcome')
    expect(categoryLabel('action_required')).toBe('Action required before race day')
  })

  it('falls back to the raw value rather than showing nothing', () => {
    expect(categoryLabel('something_new')).toBe('something_new')
  })
})

/**
 * Turning an AdminSkiRacing membership export into a reviewable set of changes.
 *
 * Everything here is pure: it takes rows and the current state, and returns what
 * would change. The database work lives in the admin action, so the decisions — who
 * matches whom, what counts as a change, whose phone number wins — can be tested
 * without one.
 *
 * THE EXPORT IS CUMULATIVE AND IS IMPORTED REPEATEDLY through the season, to catch
 * members who joined since. Each download holds everyone, not just the additions. So
 * the second run has 160 already-known rows and 8 new ones, and a diff that lists all
 * 168 is one nobody will read. The diff is therefore against what we already hold,
 * not against the file.
 */

import { toE164 } from './phone'
import type { CsvRow } from './asr-csv'

/** Columns the import cannot proceed without. */
export const REQUIRED_COLUMNS = [
  'First Name',
  'Last Name',
  'USSA#',
  'Cell Phone',
  'Email',
  'Event_id',
]

/** One member, reduced to what this system actually uses. */
export interface MemberRow {
  firstName: string
  lastName: string
  yob: number | null
  gender: string | null
  /** Digits only — the letter prefix (F, X, C, E, P) is dropped, as everywhere. */
  usssa: number | null
  fis: number | null
  /** E.164, or null when it could not be read as a number. */
  phone: string | null
  email: string
  className: string | null
  bib: string | null
  /** The racer's home division. Stored, never filtered on. */
  raceSeries: string | null
  /** Registration Date, as an ISO string. */
  joinedAt: string | null
  eventId: string
}

/** Strip the letter prefix and any punctuation; return digits as a number. */
function usssaNumber(raw: string): number | null {
  const digits = raw.replace(/[\s-]/g, '').replace(/^[A-Za-z]+/, '')
  return /^\d+$/.test(digits) ? Number(digits) : null
}

function optionalNumber(raw: string): number | null {
  const digits = raw.replace(/\D/g, '')
  return digits ? Number(digits) : null
}

function blankToNull(raw: string): string | null {
  const t = raw.trim()
  return t === '' ? null : t
}

/**
 * ASR writes dates as "01/02/2026 13:31:48 PST".
 *
 * Returns null rather than guessing when it cannot be read — a membership with an
 * unknown join date is still a membership, and inventing a date would make "who
 * joined since the last import" quietly wrong.
 */
export function parseAsrDate(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw.trim())
  if (!m) return null
  const [, month, day, year] = m
  const date = new Date(`${year}-${month}-${day}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Reduce export rows to what we import.
 *
 * DELIBERATELY NARROW. The export also carries allergies — including insurance and
 * patient record numbers for at least one member — plus emergency contacts, home
 * addresses and shirt sizes. Those exist for race-day administration in ASR and have
 * no purpose here, so they are not read at all rather than read and discarded.
 */
export function toMemberRows(rows: CsvRow[]): MemberRow[] {
  return rows.map((r) => ({
    firstName: (r['First Name'] ?? '').trim(),
    lastName: (r['Last Name'] ?? '').trim(),
    yob: optionalNumber(r['YOB'] ?? ''),
    gender: blankToNull(r['Gender'] ?? ''),
    usssa: usssaNumber(r['USSA#'] ?? ''),
    fis: optionalNumber(r['FIS#'] ?? ''),
    phone: toE164(r['Cell Phone'] ?? ''),
    email: (r['Email'] ?? '').trim(),
    className: blankToNull(r['Class'] ?? ''),
    bib: blankToNull(r['FarWest Bib Number'] ?? ''),
    raceSeries: blankToNull(r['Race Series'] ?? ''),
    joinedAt: parseAsrDate(r['Registration Date'] ?? ''),
    eventId: (r['Event_id'] ?? '').trim(),
  }))
}

// ---------------------------------------------------------------------------
// Matching and the diff
// ---------------------------------------------------------------------------

/** The fields of an existing person the import compares against. */
export interface ExistingPerson {
  id: string
  first_name: string
  last_name: string
  usssa: number | null
  phone: string | null
  email: string | null
  /** Whether they have opted in for texts, which decides whose phone number wins. */
  opt_in_at: string | null
}

export type MatchMethod = 'usssa' | 'email' | 'phone'

export interface FieldChange {
  field: string
  from: string | null
  to: string | null
}

export interface DiffEntry {
  member: MemberRow
  personId: string | null
  matchedBy: MatchMethod | null
  /** Blanks this import would fill. Applied. */
  changes: FieldChange[]
  /** Where ASR disagrees with a value we hold. Reported, never applied. */
  differences: FieldChange[]
}

export interface ImportDiff {
  rowsInFile: number
  /** Held no membership for this season, and now would. */
  joined: DiffEntry[]
  /** Already a member for this season; listed only when something would change. */
  updated: DiffEntry[]
  /** Already a member, nothing to change. Counted, not listed. */
  unchanged: number
  /** In our data as a member for this season, absent from this export. */
  missing: Array<{ personId: string; name: string }>
  /** Nobody in the club matches. These need a person creating, or a look. */
  unmatched: DiffEntry[]
}

/**
 * Find the person this row is about.
 *
 * USSA number first: it is assigned by US Ski & Snowboard, printed on the card, and
 * matched 155 of 168 rows in the 2025-2026 export. Email next, phone last — both are
 * things people change, and a shared household phone can point at the wrong person.
 *
 * Note this differs from the opt-in queue's order (#21), which puts phone first. The
 * reason is what each source is: a member typing into a consent form is telling us
 * where to text them, so their number decides. A roster from ASR is an administrative
 * record, and its stable identifier is the USSA number.
 */
export function matchPerson(
  member: MemberRow,
  people: ExistingPerson[]
): { person: ExistingPerson; matchedBy: MatchMethod } | null {
  if (member.usssa != null) {
    const hit = people.find((p) => p.usssa === member.usssa)
    if (hit) return { person: hit, matchedBy: 'usssa' }
  }

  const email = member.email.toLowerCase()
  if (email) {
    const hit = people.find((p) => (p.email ?? '').toLowerCase() === email)
    if (hit) return { person: hit, matchedBy: 'email' }
  }

  if (member.phone) {
    const hit = people.find((p) => p.phone === member.phone)
    if (hit) return { person: hit, matchedBy: 'phone' }
  }

  return null
}

/**
 * Which contact details this import would FILL IN on an existing person.
 *
 * THE RULE: fill a blank, never overwrite a value.
 *
 * An earlier version kept our value only when the person had opted in for texts, and
 * took ASR's otherwise. Melissa spotted the flaw on 2026-08-16 while reading a
 * preview: email was collected through the opt-in form long before this system
 * existed, so an address on file is very often the member's own — and for exactly the
 * people whose `opt_in_at` never came across in the migration, which is who that rule
 * would have overwritten. There is no way now to tell a member-supplied address from
 * an imported one.
 *
 * So the import stops guessing. It fills gaps, which takes nothing away from anyone,
 * and leaves every existing value alone. Where ASR disagrees, that is reported
 * separately (see `contactDifferences`) for a person to act on, and ASR's own value is
 * always kept in `asr_phone` / `asr_email` regardless, so nothing is lost.
 */
export function contactChanges(
  member: MemberRow,
  person: ExistingPerson
): FieldChange[] {
  const changes: FieldChange[] = []

  if (member.phone && !person.phone) {
    changes.push({ field: 'phone', from: null, to: member.phone })
  }

  const email = member.email.trim()
  if (email && !person.email) {
    changes.push({ field: 'email', from: null, to: email })
  }

  // Never overwritten either: changing a USSA number can detach somebody from their
  // own race history, which belongs in member admin (#59), not in a bulk import.
  if (member.usssa != null && person.usssa == null) {
    changes.push({ field: 'usssa', from: null, to: String(member.usssa) })
  }

  return changes
}

/**
 * Where ASR disagrees with a value we already hold.
 *
 * Reported, never applied. These are the interesting rows — a member who has moved
 * from a work address to a personal one, or a number that has changed — but which of
 * the two is right is a judgement, and often the answer is ours: the member typed it
 * into the opt-in form themselves.
 *
 * Surfacing them means the officer can act on the ones that matter without the import
 * quietly deciding for them.
 */
export function contactDifferences(
  member: MemberRow,
  person: ExistingPerson
): FieldChange[] {
  const differences: FieldChange[] = []

  if (member.phone && person.phone && member.phone !== person.phone) {
    differences.push({ field: 'phone', from: person.phone, to: member.phone })
  }

  const email = member.email.trim()
  if (email && person.email && email.toLowerCase() !== person.email.toLowerCase()) {
    differences.push({ field: 'email', from: person.email, to: email })
  }

  if (member.usssa != null && person.usssa != null && member.usssa !== person.usssa) {
    differences.push({
      field: 'usssa',
      from: String(person.usssa),
      to: String(member.usssa),
    })
  }

  return differences
}

/**
 * Work out what this export would do.
 *
 * @param members       parsed export rows
 * @param people        everyone currently in the club
 * @param currentMember person ids already holding a membership for this season
 */
export function buildDiff(
  members: MemberRow[],
  people: ExistingPerson[],
  currentMember: Set<string>
): ImportDiff {
  const diff: ImportDiff = {
    rowsInFile: members.length,
    joined: [],
    updated: [],
    unchanged: 0,
    missing: [],
    unmatched: [],
  }

  const seen = new Set<string>()

  for (const member of members) {
    const found = matchPerson(member, people)

    if (!found) {
      diff.unmatched.push({
        member,
        personId: null,
        matchedBy: null,
        changes: [],
        differences: [],
      })
      continue
    }

    seen.add(found.person.id)
    const changes = contactChanges(member, found.person)
    const entry: DiffEntry = {
      member,
      personId: found.person.id,
      matchedBy: found.matchedBy,
      changes,
      differences: contactDifferences(member, found.person),
    }

    if (!currentMember.has(found.person.id)) diff.joined.push(entry)
    else if (changes.length > 0 || entry.differences.length > 0) diff.updated.push(entry)
    else diff.unchanged++
  }

  // Present in our data for this season, absent from the export.
  //
  // FLAGGED, NEVER ACTED ON. The export is cumulative, so a disappearance means a
  // refund or a correction made in ASR — and quietly deleting somebody's membership
  // because a row vanished from a file is not a decision code should take.
  for (const id of currentMember) {
    if (seen.has(id)) continue
    const person = people.find((p) => p.id === id)
    diff.missing.push({
      personId: id,
      name: person ? `${person.first_name} ${person.last_name}` : 'Unknown member',
    })
  }

  return diff
}

/**
 * Every entry this import would change contact details on, whether the person is
 * joining now or was already a member.
 *
 * Exists because the preview got this wrong: on a FIRST import everyone lands in
 * `joined`, so counting only `updated` reported zero contact changes while thirteen
 * were about to be applied. A preview that under-reports what it will do defeats the
 * point of having one.
 */
export function entriesWithChanges(diff: ImportDiff): DiffEntry[] {
  return [...diff.joined, ...diff.updated].filter((e) => e.changes.length > 0)
}

/** How many field changes in total, for the summary figure. */
export function changeCount(diff: ImportDiff): number {
  return entriesWithChanges(diff).reduce((n, e) => n + e.changes.length, 0)
}

/** Everyone where ASR holds something different from us. Reported, not applied. */
export function entriesWithDifferences(diff: ImportDiff): DiffEntry[] {
  return [...diff.joined, ...diff.updated].filter((e) => e.differences.length > 0)
}

/**
 * A stable name for one proposed overwrite, so the preview and the apply step can
 * refer to the same thing.
 *
 * Person id and field only — deliberately NOT the value. Apply re-derives every
 * difference from the file, then applies the ticked ones, so this identifies WHICH
 * correction was accepted while the value itself still comes from the export. A
 * tampered form can decline a change or accept one; it cannot invent a new value.
 */
export function differenceKey(personId: string, field: string): string {
  return `${personId}:${field}`
}

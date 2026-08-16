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
  /** Contact details this import would change on the person record. */
  changes: FieldChange[]
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
 * Which contact details this import would change on an existing person.
 *
 * THE RULE (Melissa): if what we hold differs from ASR and the person HAS opted in
 * for texts, keep ours — ours came from the member themselves, through the opt-in
 * form. If they have NOT opted in, take ASR's, because ASR is then the more recently
 * maintained record.
 *
 * A missing value on our side is always filled, opted in or not: filling a blank
 * takes nothing away.
 */
export function contactChanges(
  member: MemberRow,
  person: ExistingPerson
): FieldChange[] {
  const changes: FieldChange[] = []
  const optedIn = !!person.opt_in_at

  if (member.phone && member.phone !== person.phone) {
    if (!person.phone || !optedIn) {
      changes.push({ field: 'phone', from: person.phone, to: member.phone })
    }
  }

  const email = member.email.trim()
  if (email && email.toLowerCase() !== (person.email ?? '').toLowerCase()) {
    if (!person.email || !optedIn) {
      changes.push({ field: 'email', from: person.email, to: email })
    }
  }

  // A missing USSA number is filled from the roster; an existing one is never
  // overwritten here. Changing it can detach somebody from their own race history,
  // which is a decision for member admin (#59), not for a bulk import.
  if (member.usssa != null && person.usssa == null) {
    changes.push({ field: 'usssa', from: null, to: String(member.usssa) })
  }

  return changes
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
      diff.unmatched.push({ member, personId: null, matchedBy: null, changes: [] })
      continue
    }

    seen.add(found.person.id)
    const changes = contactChanges(member, found.person)
    const entry: DiffEntry = {
      member,
      personId: found.person.id,
      matchedBy: found.matchedBy,
      changes,
    }

    if (!currentMember.has(found.person.id)) diff.joined.push(entry)
    else if (changes.length > 0) diff.updated.push(entry)
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

/**
 * Turning an AdminSkiRacing race roster into a reviewable set of race entries.
 *
 * Pure, like the membership importer next door: rows and current state in, what
 * would change out. The database work lives in the admin action.
 *
 * THE FILE IS NOT SHAPED LIKE THE MEMBERSHIP EXPORT, and the differences are the
 * whole reason this file exists rather than a few more branches over there:
 *
 *   - **The races are columns, not rows.** One download covers a whole weekend.
 *     The last columns are headed like "Mammoth Season Opener GS #1 [GS] (12/31)
 *     [45]", and a registration timestamp in that cell is the entry. So the file
 *     declares which races it is about; nobody has to say so up front.
 *
 *   - **An empty cell is a statement, not a silence.** A person registered for
 *     the event but not racing on Sunday appears in the file with Sunday's cell
 *     blank. That is how a withdrawal arrives: the row stays, the cell empties.
 *     Melissa, 2026-11-27: "If someone withdraws, a future import would show
 *     their name with neither box checked."
 *
 *   - **The columns are spelled differently.** "USSSA#" with three S where the
 *     membership export writes "USSA#", and "Phone" where it writes "Cell
 *     Phone". There is no Event_id, no bib and no Participant_id at all.
 *
 * NON-MEMBERS ARE EXPECTED HERE. Temp racers and skiers from other divisions
 * enter Far West races; an entrant who matches nobody is normal, not a fault.
 */

import { toE164 } from './phone'
import type { CsvRow } from './asr-csv'
import {
  matchPerson,
  usssaNumber,
  type ExistingPerson,
  type MatchMethod,
  type MemberRow,
} from './membership-import'

/** Columns the roster import cannot proceed without. */
export const ROSTER_REQUIRED_COLUMNS = ['First Name', 'Last Name', 'Email', 'Phone']

/**
 * A race, as the file names it.
 *
 * ASR writes: `Mammoth Season Opener GS #1 [GS] (12/31) [45]`
 *              ^name                          ^disc ^date  ^count
 *
 * The date is NOT the race date — it reads (12/31) on a file for races on the
 * 5th and 6th of December, so it is a registration deadline or some other ASR
 * notion. It is parsed and kept only so the officer can see it; the race these
 * entries belong to is chosen explicitly, never inferred from this.
 */
export interface RaceColumn {
  /** The header exactly as ASR wrote it. The key into each row. */
  header: string
  /** "Mammoth Season Opener GS #1" */
  name: string
  /** "GS", "SL", "SG" — as ASR writes it, not validated against our enum. */
  discipline: string
  /** Whatever ASR put in the parentheses, unparsed. Shown, never trusted. */
  dateLabel: string
  /**
   * The count ASR printed in the trailing brackets.
   *
   * A checksum and nothing more. It matched the real cell count exactly on the
   * 2026-11-27 Mammoth file (45 and 41), so a disagreement means the file is
   * truncated or has been parsed wrongly — worth catching, since both failures
   * otherwise look like a quiet weekend.
   */
  statedCount: number
}

const RACE_HEADER = /^(.*?)\s*\[([A-Za-z]+)\]\s*\(([^)]*)\)\s*\[(\d+)\]\s*$/

/**
 * Find the race columns among the ordinary ones.
 *
 * Matched by shape rather than by position: ASR puts them last today, but a
 * column added to the end of the export would silently become a race otherwise.
 */
export function raceColumns(rows: CsvRow[]): RaceColumn[] {
  if (rows.length === 0) return []

  const found: RaceColumn[] = []
  for (const header of Object.keys(rows[0])) {
    const m = RACE_HEADER.exec(header)
    if (!m) continue
    found.push({
      header,
      name: m[1].trim(),
      discipline: m[2].toUpperCase(),
      dateLabel: m[3].trim(),
      statedCount: Number(m[4]),
    })
  }
  return found
}

/**
 * One entrant, reduced to what matching needs.
 *
 * DELIBERATELY NARROW, for the same reason as the membership importer: this file
 * carries home addresses, emergency contacts and allergies — one row of the
 * 2026-11-27 Mammoth roster names an implanted medical device. None of it is
 * read rather than read and dropped.
 */
export function toRosterRows(rows: CsvRow[]): MemberRow[] {
  return rows.map((r) => ({
    firstName: (r['First Name'] ?? '').trim(),
    lastName: (r['Last Name'] ?? '').trim(),
    yob: numberOrNull(r['YOB'] ?? ''),
    gender: blankToNull(r['Gender'] ?? ''),
    // "USSSA#" here, "USSA#" in the membership export. Same number.
    usssa: usssaNumber(r['USSSA#'] ?? ''),
    fis: numberOrNull(r['FIS#'] ?? ''),
    // "Phone" here, "Cell Phone" there. Formats in one real file: 8015544185,
    // 949-303-3129, 17025393861, (650) 283-9403 — toE164 handles all of them.
    phone: toE164(r['Phone'] ?? ''),
    email: (r['Email'] ?? '').trim(),
    className: blankToNull(r['Class'] ?? ''),
    bib: null,
    raceSeries: null,
    joinedAt: null,
    eventId: '',
  }))
}

function numberOrNull(raw: string): number | null {
  const digits = raw.replace(/\D/g, '')
  return digits ? Number(digits) : null
}

function blankToNull(raw: string): string | null {
  const t = raw.trim()
  return t === '' ? null : t
}

/** An entrant the file lists for a race, and who we think they are. */
export interface RosterEntrant {
  racer: MemberRow
  /** Null when nobody in the club matches — a temp racer or another division. */
  personId: string | null
  matchedBy: MatchMethod | null
}

export interface RaceDiff {
  column: RaceColumn
  /** Whether `statedCount` agreed with the cells actually filled in. */
  countMatches: boolean
  /** Cells actually filled in for this race. */
  inFile: number
  /** Entered in the file, not yet in race_entries. */
  newEntries: RosterEntrant[]
  /** Entered in the file and already recorded. Counted, not listed. */
  alreadyEntered: number
  /**
   * Recorded as entered, and the file now says otherwise.
   *
   * Two ways to arrive: the row is present with this race's cell empty (the
   * ordinary withdrawal), or the person has gone from the file altogether. Both
   * mean ASR no longer has them in this race.
   */
  withdrawn: Array<{ personId: string; name: string; stillInFile: boolean }>
  /**
   * Entrants matching nobody in the club. Expected, not an error: temp racers
   * and other divisions. Listed in full so a duplicate spelling of somebody we
   * already hold gets noticed before it becomes a second record for one human.
   */
  tempRacers: RosterEntrant[]
}

/** Who we already have entered, per race. */
export interface ExistingEntry {
  personId: string
  name: string
}

/**
 * Work out what this file would do to one race.
 *
 * @param column   the race column within the file
 * @param rows     every row of the file, parsed
 * @param people   everyone currently in the club
 * @param existing who is already in race_entries for this race
 */
export function buildRaceDiff(
  column: RaceColumn,
  rows: CsvRow[],
  racers: MemberRow[],
  people: ExistingPerson[],
  existing: ExistingEntry[]
): RaceDiff {
  const enteredNow: RosterEntrant[] = []
  const seenPersonIds = new Set<string>()
  // Everybody the file mentions at all, entered in this race or not — the
  // difference between "withdrew" and "vanished from the event".
  const personIdsAnywhereInFile = new Set<string>()

  rows.forEach((row, i) => {
    const racer = racers[i]
    if (!racer) return

    const hit = matchPerson(racer, people)
    const entrant: RosterEntrant = {
      racer,
      personId: hit?.person.id ?? null,
      matchedBy: hit?.matchedBy ?? null,
    }
    if (entrant.personId) personIdsAnywhereInFile.add(entrant.personId)

    // THE ENTRY IS THE TIMESTAMP. Empty means not in this race — see the note
    // at the top of this file about why that is a statement and not a silence.
    if ((row[column.header] ?? '').trim() === '') return

    enteredNow.push(entrant)
    if (entrant.personId) seenPersonIds.add(entrant.personId)
  })

  const alreadyHave = new Map(existing.map((e) => [e.personId, e]))

  const newEntries = enteredNow.filter(
    (e) => e.personId && !alreadyHave.has(e.personId)
  )
  const alreadyEntered = enteredNow.filter(
    (e) => e.personId && alreadyHave.has(e.personId)
  ).length

  const withdrawn = existing
    .filter((e) => !seenPersonIds.has(e.personId))
    .map((e) => ({
      personId: e.personId,
      name: e.name,
      stillInFile: personIdsAnywhereInFile.has(e.personId),
    }))

  return {
    column,
    inFile: enteredNow.length,
    countMatches: enteredNow.length === column.statedCount,
    newEntries,
    alreadyEntered,
    withdrawn,
    tempRacers: enteredNow.filter((e) => !e.personId),
  }
}

/**
 * Withdrawals are ticked for removal by default.
 *
 * Melissa, 2026-11-27, choosing this over report-only. The membership importer
 * refuses to act on a member who vanishes from a cumulative export, because
 * there it is ambiguous — a refund, an ASR correction, who knows. Here it is
 * not: an empty cell is AdminSkiRacing stating the person is not in that race,
 * and leaving the row means "everyone racing on Saturday" texts somebody who
 * pulled out, which is the exact thing race entries exist to prevent.
 *
 * Still only a default. Every name is on screen with its tick showing, counted
 * in the summary and named on the button, before anything is deleted.
 */
export function defaultWithdrawals(diffs: RaceDiff[]): Set<string> {
  const keys = new Set<string>()
  for (const d of diffs) {
    for (const w of d.withdrawn) keys.add(withdrawalKey(d.column.header, w.personId))
  }
  return keys
}

/** A stable name for one proposed removal, so preview and apply agree. */
export function withdrawalKey(columnHeader: string, personId: string): string {
  return `${columnHeader}::${personId}`
}

/**
 * How many people would be created, across every race in the file.
 *
 * NOT the sum of each race's `tempRacers`. Somebody racing both days of a
 * weekend is a temp racer in both columns and one human: summing told an
 * officer that a 45-person file would create 47 people. One identity, one
 * person — which is also exactly what the apply step does, so the number shown
 * and the number created cannot drift apart.
 */
export function countTempRacers(diffs: RaceDiff[]): number {
  const seen = new Set<string>()
  for (const d of diffs) {
    for (const e of d.tempRacers) seen.add(racerIdentity(e.racer))
  }
  return seen.size
}

/**
 * How we decide two rows are the same human when neither is in the club yet.
 *
 * USSA number first because it is assigned and printed on a card; email next;
 * the phone last. Never the name — this file writes "Shareen ", "Mark " and
 * "Hlubucek " with trailing spaces.
 */
export function racerIdentity(r: Pick<MemberRow, 'usssa' | 'email' | 'phone'>): string {
  if (r.usssa != null) return `u:${r.usssa}`
  if (r.email) return `e:${r.email.toLowerCase()}`
  return `p:${r.phone ?? ''}`
}

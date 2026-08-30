/**
 * Compare a parsed schedule against the races already on file.
 *
 * Pure, and separate from the screen that renders it, for the same reason
 * membership-import.ts is: this is the part that decides what happens to data, and it
 * should be testable without a database or a browser.
 *
 * The governing rule is the one the membership import already established — **nothing
 * already on file is overwritten**. Here that matters more, not less: a race carries
 * results, and results are 18 years of club history that the parity harness checks
 * against every published standing since 2009.
 */

import { factorsForSeason } from '@fwm/results-engine/types'
import type { Discipline, ParsedRace, ParseWarning } from './schedule-parse'

export interface ExistingRace {
  id: string
  date: string
  discipline: Discipline
  venue: string | null
  name: string
  status: string
  countsTowardStandings: boolean
  /** Hand-entered, and never touched by an import. */
  liveTimingId: number | null
  usssaRaceCode: string | null
  notes: string | null
  /** Whether any results have been imported for this race. */
  hasResults: boolean
}

export interface FieldChange {
  field: string
  from: string
  to: string
}

export interface DiffEntry {
  existing: ExistingRace
  changes: FieldChange[]
  /** Set when the change must not be applied automatically. */
  blockedReason: string | null
}

export interface NewRace {
  date: string
  discipline: Discipline
  venue: string
  name: string
  slug: string
  factor: number
  runCount: number
  countsTowardStandings: boolean
  status: 'scheduled' | 'canceled'
  series: string | null
  notes: string | null
}

export interface ScheduleDiff {
  season: string
  toAdd: NewRace[]
  toChange: DiffEntry[]
  /** Changes to races that already have results. Never applied without a decision. */
  conflicts: DiffEntry[]
  unchangedCount: number
  /** On file but not on the page. LEFT ALONE — see below. */
  onFileNotOnPage: ExistingRace[]
  warnings: ParseWarning[]
  /**
   * True when the page yielded no races at all.
   *
   * Apply must refuse on this. A restructured page, a failed fetch or a changed
   * table class all produce an empty parse, and an empty parse is indistinguishable
   * from "every race was removed" — which would otherwise read as a licence to
   * cancel a whole season.
   */
  empty: boolean
}

/** Speed events run once; technical events run twice. */
const RUN_COUNT: Record<Discipline, number> = {
  SL: 2,
  GS: 2,
  // Assumption, and worth knowing where it bites: the results importer refuses a
  // two-run race that only has run 1 on live-timing (see RUNBOOK). Marking a
  // single-run SG as run_count 2 would make it refuse a complete race. Correct this
  // here if the club ever runs a two-run super-G.
  SG: 1,
  DH: 1,
  AC: 1,
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 'March 06, 2027' — matching the naming already in the schema's example. */
function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${String(d).padStart(2, '0')}, ${y}`
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The key that decides whether a parsed race is one already on file.
 *
 * Date, discipline and venue — deliberately NOT the name, which contains an event
 * title that can be added or reworded on the page without anything having changed
 * about the race.
 *
 * Note this key is not unique, and that is the point: 'SG / SG' on one day is two
 * genuinely distinct races sharing a date, discipline and venue. So the diff compares
 * COUNTS per key rather than matching one row to one row, which is what stops the
 * second Northstar super-G being reported as missing every single time.
 */
export function raceKey(race: {
  date: string
  discipline: string
  venue: string | null
}): string {
  return `${race.date}|${race.discipline}|${(race.venue ?? '').toLowerCase().trim()}`
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

/** Build the races to insert for one key, numbered when there is more than one. */
function newRacesFor(
  parsed: ParsedRace[],
  count: number,
  totalInGroup: number,
  offset: number,
  seasonEndYear: number
): NewRace[] {
  const factors = factorsForSeason(seasonEndYear)
  const out: NewRace[] = []

  for (let i = 0; i < count; i++) {
    const race = parsed[0]
    const index = offset + i + 1
    const suffix = totalInGroup > 1 ? ` (${index} of ${totalInGroup})` : ''
    const title = race.eventName ?? race.venue
    const slugBase = `${race.date.replace(/-/g, '')}-${slugify(title)}-${race.discipline.toLowerCase()}`

    out.push({
      date: race.date,
      discipline: race.discipline,
      venue: race.venue,
      name: `${title} ${race.discipline} - ${longDate(race.date)}${suffix}`,
      slug: totalInGroup > 1 ? `${slugBase}-${index}of${totalInGroup}` : slugBase,
      factor: factors[race.discipline],
      runCount: RUN_COUNT[race.discipline],
      countsTowardStandings: race.countsForStandings,
      status: race.status,
      // The event title doubles as the series, which is what groups a race weekend
      // for texting — 'Bernard Cup', 'Mammoth Speed Races'.
      series: race.eventName,
      notes: race.note,
    })
  }

  return out
}

/**
 * What importing this schedule would do.
 *
 * Writes nothing. The screen renders this, and only an explicit Apply acts on it.
 */
export function buildScheduleDiff(
  parsed: ParsedRace[],
  existing: ExistingRace[],
  options: { season: string; warnings?: ParseWarning[] }
): ScheduleDiff {
  const { season, warnings = [] } = options
  const seasonEndYear = Number(season.split('-')[1] ?? season)

  const parsedGroups = groupBy(parsed, raceKey)
  const existingGroups = groupBy(existing, raceKey)

  const toAdd: NewRace[] = []
  const toChange: DiffEntry[] = []
  const conflicts: DiffEntry[] = []
  const onFileNotOnPage: ExistingRace[] = []
  let unchangedCount = 0

  for (const [key, group] of parsedGroups) {
    const already = existingGroups.get(key) ?? []

    // More on the page than on file: add the difference.
    if (group.length > already.length) {
      toAdd.push(
        ...newRacesFor(
          group,
          group.length - already.length,
          group.length,
          already.length,
          seasonEndYear
        )
      )
    }

    // Compare the ones that do exist.
    for (const race of already) {
      const source = group[0]
      const changes: FieldChange[] = []

      if (race.status !== source.status && race.status === 'scheduled') {
        changes.push({ field: 'status', from: race.status, to: source.status })
      }
      if (race.countsTowardStandings !== source.countsForStandings) {
        changes.push({
          field: 'counts toward standings',
          from: String(race.countsTowardStandings),
          to: String(source.countsForStandings),
        })
      }

      if (!changes.length) {
        unchangedCount++
        continue
      }

      // A race with results is history. Changing its status or its scoring
      // eligibility would rewrite a published standing, and the parity harness
      // compares every one of those against results going back to 2009. So this is
      // surfaced for a decision rather than applied.
      const entry: DiffEntry = {
        existing: race,
        changes,
        blockedReason: race.hasResults
          ? 'This race already has results imported. Changing it would alter a published standing.'
          : null,
      }

      if (entry.blockedReason) conflicts.push(entry)
      else toChange.push(entry)
    }
  }

  // On file, absent from the page.
  //
  // LEFT ALONE, and listed — exactly as the membership import treats somebody held
  // for the season but missing from the export. A race disappearing from a web page
  // is not evidence it did not happen, and deleting it would orphan every result
  // attached to it. Usually this is a race added by hand, or one the page dropped
  // after it ran.
  for (const [key, group] of existingGroups) {
    const onPage = parsedGroups.get(key)?.length ?? 0
    if (onPage < group.length) onFileNotOnPage.push(...group.slice(onPage))
  }

  return {
    season,
    toAdd,
    toChange,
    conflicts,
    unchangedCount,
    onFileNotOnPage,
    warnings,
    empty: parsed.length === 0,
  }
}

/** Does this diff propose anything at all? */
export function hasChanges(diff: ScheduleDiff): boolean {
  return diff.toAdd.length > 0 || diff.toChange.length > 0
}

/**
 * A stable fingerprint of the schedule HTML, for spotting an edited page.
 *
 * Stored after an import and compared on the next page load, so the app can say "the
 * schedule has changed since you last imported it" — exact, rather than the
 * membership import's time-based "it has been two weeks". The schedule lives in the
 * repository, so editing it is a commit, and this turns that commit into a prompt.
 *
 * Whitespace is normalised first: reformatting the file should not read as a change
 * to the schedule.
 *
 * FNV-1a rather than a crypto hash — this detects an edit, it does not defend against
 * one, and it needs to run identically without pulling in node:crypto.
 */
export function scheduleFingerprint(html: string): string {
  const normalised = html.replace(/\s+/g, ' ').trim()
  let hash = 0x811c9dc5
  for (let i = 0; i < normalised.length; i++) {
    hash ^= normalised.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

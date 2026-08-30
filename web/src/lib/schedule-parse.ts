/**
 * Turn the published schedule table into races.
 *
 * The published page is a list of race *weekends*; `races` is one row per race. That
 * expansion is the whole job, and it is where an importer can quietly invent or lose
 * races — so every row that cannot be expanded confidently produces a warning instead
 * of a guess, and the preview screen shows those before anything is written.
 *
 * Pure, like schedule-html.ts. Tested against both archived seasons: 2026-27 for the
 * prospective shape and 2025-26 for the messy end-of-season one, which carries every
 * cancellation, make-up and reschedule the club produced in a real winter.
 */

import { scheduleRows, type Row } from './schedule-html'

/** Matches the `discipline` enum in the initial schema. */
export type Discipline = 'SL' | 'GS' | 'SG' | 'DH' | 'AC'

const DISCIPLINES: Discipline[] = ['SL', 'GS', 'SG', 'DH', 'AC']

export interface ParsedRace {
  /** ISO 'YYYY-MM-DD'. */
  date: string
  discipline: Discipline
  venue: string
  /** 'Bernard Cup', 'Mammoth Speed Races' — null for an ordinary race weekend. */
  eventName: string | null
  /** False for out-of-region and [unscored] races. Migration 0003's flag. */
  countsForStandings: boolean
  status: 'scheduled' | 'canceled'
  /** What the page said, when it said something a human needs to read. */
  note: string | null
  /** Index into the page's data rows, so the preview can point at the source. */
  sourceRow: number
}

export interface ParseWarning {
  sourceRow: number
  /** The date cell as published, to identify the row on screen. */
  date: string
  message: string
}

export interface ScheduleParse {
  races: ParsedRace[]
  /** Rows that could not be expanded confidently. Never silently dropped. */
  warnings: ParseWarning[]
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

/** 'YYYY-MM-DD' from parts, without going through a local-time Date. */
function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Weekday index for a date, computed in UTC so the host timezone cannot shift it. */
function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * The two calendar years a season label spans. '2026-2027' -> [2026, 2027].
 *
 * The page never writes a year. December belongs to the first, January to April to
 * the second — which is also why a range like "Feb. 28-Mar. 1" needs both months
 * resolved separately rather than assuming one.
 */
export function seasonYears(season: string): [number, number] {
  const [a, b] = season.split('-').map(Number)
  return [a, b ?? a + 1]
}

function yearFor(month: number, season: string): number {
  const [first, second] = seasonYears(season)
  // Racing runs autumn to spring. September onward is the opening calendar year.
  return month >= 9 ? first : second
}

/**
 * Every date covered by a published date cell.
 *
 * Handles the four shapes the two archives contain:
 *   'Feb. 19'            single day
 *   'Dec. 5-6'           range within a month
 *   'December 6-7'       month spelled out
 *   'Feb. 28-Mar. 1'     range crossing a month, and therefore possibly a year
 */
export function parseDateRange(text: string, season: string): string[] {
  const cleaned = text.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()

  // <month> <day> [ - [<month>] <day> ]
  const match =
    /^([A-Za-z]+)\s+(\d{1,2})(?:\s*[-–—]\s*(?:([A-Za-z]+)\s+)?(\d{1,2}))?/.exec(cleaned)
  if (!match) return []

  const startMonth = MONTHS[match[1].slice(0, 3).toLowerCase()]
  if (!startMonth) return []

  const startDay = Number(match[2])
  const endMonth = match[3] ? MONTHS[match[3].slice(0, 3).toLowerCase()] : startMonth
  const endDay = match[4] ? Number(match[4]) : startDay
  if (!endMonth) return []

  const startYear = yearFor(startMonth, season)
  // A range that crosses from December into January crosses the new year too.
  const endYear = endMonth < startMonth ? startYear + 1 : yearFor(endMonth, season)

  const dates: string[] = []
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay))
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay))

  // Guard against a malformed range producing an unbounded loop; a race weekend is
  // never longer than a fortnight.
  for (let i = 0; cursor <= end && i < 14; i++) {
    dates.push(
      iso(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate())
    )
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return dates
}

/**
 * Check the computed dates against the weekdays the page states.
 *
 * Every row annotates its range — 'Dec. 5-6 (Sat-Sun)', 'Apr. 7-10 (Wed-Sat)' — and
 * the page never writes a year. Inferring the wrong year is therefore the one parsing
 * error that produces entirely plausible output: correct months, correct days, every
 * race a year out. Nothing downstream would catch it.
 *
 * The weekdays are the check. 5 December is a Saturday in 2026 and a Friday in 2025,
 * so comparing the club's own annotation against the computed date makes a wrong year
 * impossible to miss. This is free evidence the page already publishes, and using it
 * turns the riskiest inference here into a verified one.
 *
 * @returns a description of the disagreement, or null when they agree.
 */
export function weekdayMismatch(annotation: string, dates: string[]): string | null {
  const named = [...annotation.matchAll(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/gi)].map(
    (m) => m[1].slice(0, 3).toLowerCase()
  )
  if (!named.length || !dates.length) return null

  const expected = WEEKDAYS[named[0]]
  const actual = weekdayOf(dates[0])
  if (expected === actual) return null

  const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return (
    `the page says ${NAMES[expected]} but ${dates[0]} is a ${NAMES[actual]} — ` +
    `the season year is probably wrong`
  )
}

interface DisciplineToken {
  discipline: Discipline
  /** Weekday abbreviation when the cell says 'Fri: SG / SG'. */
  day: string | null
}

/**
 * Disciplines from a cell, expanded to one entry per race.
 *
 * The notations in the two archives, all of which appear here:
 *
 *   'GS'                                    one race
 *   'GS / GS'                               two
 *   'GS and SL'                             two, different separator
 *   'SGx2 / GSx2 / SL'                      multipliers
 *   'SGx2, GS_1x2, SL'                      multiplier with a run suffix
 *   'Fri: SG / SG, Sat: SG / SG, Sun: GS'   per-day
 *   'Thu: GS x2, Fri: SG (2x points)'       per-day, and a POINTS multiplier
 *
 * The last is the trap. '(2x points)' doubles the points for one race; 'x2' means two
 * races. Reading the first as the second invents a race that does not exist, so
 * parentheticals are removed before any multiplier is read.
 */
export function parseDisciplines(text: string): DisciplineToken[] {
  const withoutNotes = text
    .replace(/\[[^\]]*\]/g, ' ') // [unscored]
    .replace(/\([^)]*\)/g, ' ') // (2x points), (Sat-Sun)
    .replace(/\s+/g, ' ')

  const tokens: DisciplineToken[] = []
  let currentDay: string | null = null

  // Split into chunks so a 'Fri:' prefix applies until the next one.
  for (const chunk of withoutNotes.split(/[,;]/)) {
    const dayMatch = /^\s*([A-Za-z]{3})[A-Za-z]*\s*:/.exec(chunk)
    let body = chunk

    if (dayMatch && dayMatch[1].toLowerCase() in WEEKDAYS) {
      currentDay = dayMatch[1].slice(0, 3).toLowerCase()
      body = chunk.slice(dayMatch[0].length)
    }

    // <discipline> [_<runs>] [x<count>]
    //
    // Note there is no `\b` after the discipline group, and that is not an oversight.
    // A word boundary does not exist between 'SG' and 'x' — both are word characters
    // — so `\bSG\b` never matches 'SGx2', and the Nakiska row silently parsed as one
    // race instead of five. The negative lookahead does the job a boundary cannot:
    // it rejects a longer word ('Slalom' is not SL) while still allowing the 'x2'
    // and '_1' suffixes that immediately follow a discipline.
    const pattern = new RegExp(
      `\\b(${DISCIPLINES.join('|')})(?:_\\d+)?(?:\\s*x\\s*(\\d+))?(?![A-Za-z])`,
      'gi'
    )
    for (const m of body.matchAll(pattern)) {
      const discipline = m[1].toUpperCase() as Discipline
      const count = m[2] ? Number(m[2]) : 1
      for (let i = 0; i < Math.min(count, 6); i++) {
        tokens.push({ discipline, day: currentDay })
      }
    }
  }

  return tokens
}

/**
 * The venue, from a Location cell that is often a whole contact block.
 *
 * The first `<br>` segment is the resort — 'Mammoth Mountain' followed by 'Race
 * Department', an email, a phone number and a postal address. The trailing state code
 * is dropped so 'Mammoth Mountain, CA' and 'Mammoth Mountain' are one venue rather
 * than two, which matters because these strings are matched against 18 years of race
 * history.
 */
export function parseVenue(cell: { segments: string[]; text: string }): string {
  const first = cell.segments.find((s) => s.trim()) ?? cell.text
  return first
    .replace(/,\s*[A-Z]{2}(\s+\d{5})?\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * An event name, when the row names one.
 *
 * 'Bernard Cup', 'Mammoth Speed Races', 'Viva Italia Cup'. Taken from the first
 * segment of Event Info, and only when it does not look like the boilerplate every
 * row carries about entry fees and registration.
 */
export function parseEventName(cell: { segments: string[] }): string | null {
  const first = cell.segments.find((s) => s.trim())
  if (!first) return null

  // Parentheticals are asides, not part of the name: 'Northstar Speed Series (both
  // Fri SG races are NSS)' is the Northstar Speed Series.
  const name = first.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  if (!name) return null

  // Every row carries the same administrative text, and the 2025-26 page leads with
  // pricing — 'Entries: $45 per race*'. A price is not an event name, and a colon or
  // a currency symbol is a reliable sign of the boilerplate rather than a title.
  const boilerplate =
    /entry fee|entries|deadline|registration|sign-?up|check-?in|no day-of-race|per race|TBA/i
  if (boilerplate.test(name) || /[$:]/.test(name)) return null

  return name.length > 60 ? null : name
}

/**
 * Expand one published row into races.
 *
 * Assignment of races to days, in the order it is tried:
 *
 *   1. The cell names days ('Fri: SG / SG, Sat: GS'). Each race lands on the date in
 *      the range with that weekday. Unambiguous, and how the club writes anything
 *      complicated.
 *   2. One race per day, in order, when the counts match. 'GS / GS' over Sat-Sun.
 *   3. All on the one day, when the range is a single date. 'SL / SL' on Mar. 5 is
 *      two races that Friday — confirmed by the club writing 'Fri: SG / SG' for
 *      exactly that shape elsewhere.
 *
 * Anything else — four disciplines across seven days at Nationals, a race camp
 * spanning four days — is NOT guessed. It produces a warning naming the row, and no
 * races. Every such row in both archives is out-of-region or unscored, so nothing
 * that counts toward FWM standings is affected by refusing to guess.
 */
export function expandRow(row: Row, index: number, season: string): {
  races: ParsedRace[]
  warnings: ParseWarning[]
} {
  const [dateCell, locationCell, eventCell, disciplineCell] = row.cells
  const published = dateCell?.text ?? ''
  const warn = (message: string): { races: []; warnings: ParseWarning[] } => ({
    races: [],
    warnings: [{ sourceRow: index, date: published, message }],
  })

  const dates = parseDateRange(dateCell?.segments[0] ?? '', season)
  if (!dates.length) return warn(`Could not read a date from “${published}”.`)

  // Refuse rather than import a year's worth of plausible-looking wrong dates.
  const mismatch = weekdayMismatch(dateCell?.segments.slice(1).join(' ') ?? '', dates)
  if (mismatch) return warn(`“${published}” — ${mismatch}.`)

  const venue = parseVenue(locationCell ?? { segments: [], text: '' })
  if (!venue) return warn('No venue in the Location column.')

  // Only the first segment: everything after the line break is 'Race: TBA', 'Start:
  // TBA' and scoring notes. See the `<br>` rule in schedule-html.ts.
  const disciplineText = disciplineCell?.segments[0] ?? ''
  const tokens = parseDisciplines(disciplineText)
  if (!tokens.length) {
    return warn(`No disciplines in “${disciplineCell?.text ?? ''}”.`)
  }

  const className = row.className?.toLowerCase() ?? ''
  const status: 'scheduled' | 'canceled' = className.includes('cancel')
    ? 'canceled'
    : 'scheduled'

  // Two independent ways the page says a race does not count, and either is enough.
  // `out-of-region` is not geographic — the 2025-26 Mammoth Nationals carries it.
  const countsForStandings =
    !className.includes('out-of-region') &&
    !/\[unscored\]/i.test(disciplineCell?.text ?? '')

  // The status text the club writes for humans: 'RESCHEDULED TO MAR 14-15',
  // 'MAKE-UP RACE FOR DEC 6-7'. Kept verbatim onto the race rather than interpreted —
  // deciding what a reschedule means to the standings is not an importer's job.
  const noteSegment = dateCell?.segments.slice(1).join(' ') ?? ''
  const noteMatch = /\b(RESCHEDULED[^|]*|MAKE-?UP[^|]*|CANCELED|CANCELLED)/i.exec(
    noteSegment
  )
  const note = noteMatch ? noteMatch[0].replace(/\s+/g, ' ').trim() : null

  const eventName = parseEventName(eventCell ?? { segments: [] })

  const make = (date: string, discipline: Discipline): ParsedRace => ({
    date,
    discipline,
    venue,
    eventName,
    countsForStandings,
    status,
    note,
    sourceRow: index,
  })

  // 1. Days named explicitly.
  if (tokens.some((t) => t.day)) {
    const races: ParsedRace[] = []
    const warnings: ParseWarning[] = []

    for (const token of tokens) {
      if (!token.day) {
        warnings.push({
          sourceRow: index,
          date: published,
          message: `“${disciplineText}” names a day for some races but not all.`,
        })
        continue
      }
      const wanted = WEEKDAYS[token.day]
      const date = dates.find((d) => weekdayOf(d) === wanted)
      if (!date) {
        warnings.push({
          sourceRow: index,
          date: published,
          message: `“${token.day}” is not a day in ${published}.`,
        })
        continue
      }
      races.push(make(date, token.discipline))
    }

    return { races, warnings }
  }

  // 2. One per day.
  if (tokens.length === dates.length) {
    return { races: tokens.map((t, i) => make(dates[i], t.discipline)), warnings: [] }
  }

  // 3. All on a single day.
  if (dates.length === 1) {
    return { races: tokens.map((t) => make(dates[0], t.discipline)), warnings: [] }
  }

  return warn(
    `${tokens.length} races (“${disciplineText}”) across ${dates.length} days, and ` +
      `the page does not say which day each is on. Add them by hand, or ask for the ` +
      `page to name the days.`
  )
}

/** Parse a whole published schedule page. */
export function parseSchedule(html: string, season: string): ScheduleParse {
  const rows = scheduleRows(html)
  const races: ParsedRace[] = []
  const warnings: ParseWarning[] = []

  rows.forEach((row, index) => {
    const result = expandRow(row, index, season)
    races.push(...result.races)
    warnings.push(...result.warnings)
  })

  races.sort((a, b) => a.date.localeCompare(b.date))
  return { races, warnings }
}

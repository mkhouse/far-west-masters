/**
 * Parser for the season standings pages ACE Scoring publishes
 * (`SS-BestNFinishes-ByClass.html` / `-ByGender.html`).
 *
 * Layout:
 *
 *   standingsHeader   Position | Competitor | Points | St | Fn | <one column per race>
 *   groupHeader       the class a block of racers belongs to, e.g. "Men Class 13 (85-89)"
 *   racerEntry        one racer: position, name, total, starts, finishes, per-race cells
 *
 * Race columns appear in schedule order and are labelled only by venue and
 * discipline ("SugarBowl / SL"), which repeat — so columns are identified by
 * position, not by name.
 *
 * Each per-race cell holds either `points (rank)` such as `100 (1)`, a
 * non-finish status (`DNF`, `DSQ`, `DNS`), or nothing at all if the racer
 * did not start that race.
 */

import type { Gender } from './types.js'
import { parseClassLabel } from './parseAce.js'

/** One racer's result in one race, as printed in a standings cell. */
export interface StandingCell {
  /** Column index, which is also the race's position in the season schedule */
  raceIndex: number
  /** Class points earned, null when the racer didn't score */
  points: number | null
  /** Class rank achieved, null when not applicable */
  rank: number | null
  /** 'DNF' | 'DNS' | 'DSQ' when the cell records a non-finish */
  status: string | null
}

/** One racer's season standing. */
export interface StandingRow {
  /** Published position within the class, e.g. '1', '3(t)' for a tie */
  position: string
  name: string
  gender: Gender
  /** Canonical class code: 'M13', 'FOP', or legacy 'M80+' */
  ageClass: string
  /** Section header verbatim, e.g. 'Men Class 13 (85-89)' */
  classLabel: string
  isOpenClass: boolean
  /** Season total as published */
  totalPoints: number
  /** Starts (St) and finishes (Fn) as published */
  starts: number
  finishes: number
  /**
   * True when the starts count carried a '*', which marks a racer who elected
   * Open class part-way through the season.
   */
  electedOpenMidSeason: boolean
  cells: StandingCell[]
}

export interface ParsedStandings {
  /** Race column labels in schedule order, e.g. 'SugarBowl SL' */
  raceColumns: string[]
  rows: StandingRow[]
  unparsedSections: string[]
}

/** Collapse entities and whitespace in extracted cell text. */
const decode = (s: string): string =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/** Extract `<td>` cells from a row as [className, text] pairs, in order. */
function cellList(row: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const m of row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)) {
    const cls = m[1]!.match(/class="([^"]+)"/)?.[1] ?? ''
    out.push([cls, decode(m[2]!)])
  }
  return out
}

/**
 * Interpret one per-race standings cell.
 *
 * `100 (1)` -> scored 100 points for 1st in class
 * `DNF`     -> started, did not finish
 * empty     -> did not start this race
 */
function parseCell(raceIndex: number, text: string): StandingCell {
  const t = text.trim()
  if (!t) return { raceIndex, points: null, rank: null, status: null }

  const scored = t.match(/^(\d+)\s*\((\d+)\)$/)
  if (scored) {
    return {
      raceIndex,
      points: parseInt(scored[1]!, 10),
      rank: parseInt(scored[2]!, 10),
      status: null,
    }
  }

  // A non-finish, or a scored result with no rank shown.
  if (/^(DNF|DNS|DSQ|DQ)/i.test(t)) {
    return { raceIndex, points: null, rank: null, status: t.toUpperCase().startsWith('DQ') ? 'DSQ' : t.toUpperCase() }
  }

  const bare = parseInt(t, 10)
  if (!Number.isNaN(bare)) return { raceIndex, points: bare, rank: null, status: null }

  return { raceIndex, points: null, rank: null, status: t }
}

export function parseStandings(html: string): ParsedStandings {
  const rows: StandingRow[] = []
  const unparsedSections: string[] = []
  let raceColumns: string[] = []

  // Class carried forward from the most recent groupHeader.
  let currentClass: ReturnType<typeof parseClassLabel> = null
  let currentLabel = ''

  const rowRe = /<tr class="(standingsHeader|groupHeader|racerEntry)"[^>]*>([\s\S]*?)<\/tr>/g

  for (const m of html.matchAll(rowRe)) {
    const kind = m[1]!
    const cells = cellList(m[0]!)

    if (kind === 'standingsHeader') {
      // Everything after the five fixed columns is a race column.
      raceColumns = cells.slice(5).map(([, text]) => text)
      continue
    }

    if (kind === 'groupHeader') {
      // The class name sits in the `name` cell; the rest repeats the race columns.
      const label = cells.find(([cls]) => cls === 'name')?.[1] ?? ''
      if (!label) continue
      const info = parseClassLabel(label)
      currentClass = info
      currentLabel = label
      if (!info) unparsedSections.push(label)
      continue
    }

    if (!currentClass) continue // racer outside a class we recognize

    // Fixed columns, then one cell per race.
    const position = cells.find(([cls]) => cls === 'position')?.[1] ?? ''
    const name = cells.find(([cls]) => cls === 'name')?.[1] ?? ''
    if (!name) continue

    const score = cells.find(([cls]) => cls === 'score')?.[1] ?? '0'
    const counts = cells.filter(([cls]) => cls === 'sfCount').map(([, t]) => t)

    // A '*' on the starts count marks a mid-season Open class election.
    const startsRaw = counts[0] ?? '0'
    const electedOpenMidSeason = startsRaw.includes('*')

    const raceCells = cells
      .slice(5)
      .map(([, text], i) => parseCell(i, text))

    rows.push({
      position,
      // Open class rows repeat the age class in parentheses: 'Hejna, Ethan (M01)'
      name: name.replace(/\s*\([MWF]\d+\)\s*$/, '').trim(),
      gender: currentClass.gender,
      ageClass: currentClass.ageClass,
      classLabel: currentLabel,
      isOpenClass: currentClass.isOpenClass,
      totalPoints: parseInt(score.replace(/[^\d-]/g, ''), 10) || 0,
      starts: parseInt(startsRaw.replace(/[^\d]/g, ''), 10) || 0,
      finishes: parseInt((counts[1] ?? '0').replace(/[^\d]/g, ''), 10) || 0,
      electedOpenMidSeason,
      cells: raceCells,
    })
  }

  return { raceColumns, rows, unparsedSections }
}

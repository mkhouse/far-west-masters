import { isNonFinish, normalizeStatus, timeToSeconds } from './time.js'
import type { AgeGroupScheme, Gender, ParsedRace, RaceResult } from './types.js'

/**
 * Parser for the race results ACE Scoring publishes to classic.farwestmasters.org.
 *
 * Two eras have to be handled (see migration/cup-rules.md):
 *
 *   2010 onward   <td class="name">Men Class 12 (80-84)</td>     five-year classes
 *   through 2009  <td class="name">Men 80+</td>                  ten-year groups
 *
 * A parser written only for the modern header silently returns nothing for
 * pre-2010 files, because those headers contain no the word "Class" at all.
 *
 * Row shapes also vary: two-run races carry run1/run2 cells, single-run races
 * (SG, DH) carry only a result cell, and non-finishers have position '-' with
 * no racePoints cell.
 */

const decode = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/** Pull `<td class="x">v</td>` cells out of a row as a map of class -> value. */
function cells(row: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)) {
    const cls = m[1]!.match(/class="([^"]+)"/)?.[1]
    if (!cls) continue
    out.set(cls, decode(m[2]!.replace(/<[^>]+>/g, '')))
  }
  return out
}

interface ClassInfo {
  gender: Gender
  ageClass: string
  isOpenClass: boolean
  scheme: AgeGroupScheme
}

/** Interpret a section header. Returns null if it isn't a class header. */
export function parseClassLabel(label: string): ClassInfo | null {
  const s = decode(label)

  // Two different systems that share one scoring shape:
  //
  //   'Men Open Seed'   through 2015. An "open seed" group formed *during* the
  //                     race: after run 1, the fastest 5 women and 10 men across
  //                     all age classes were pulled out to run second out of the
  //                     normal age order. Membership was earned on the day.
  //
  //   'Men Open Class'  from the 2015-16 season. Racers now *declare* in advance
  //                     (by noon the day before) that they want scoring against
  //                     all ages instead of their age class.
  //
  // The eligibility rule changed completely — performance-selected became opt-in —
  // but the scoring shape did not: in both eras the racer is ranked against all
  // ages, carries their age class as a suffix ('Belden, Kurt (M50)'), and appears
  // in their age class only as a starred stub row. So both map to the same
  // scoring class here.
  //
  // Do not try to *derive* Open Seed membership: it depended on run-1 times on the
  // day. Take it from the published results, which is where we read it.
  const open = s.match(/^(Men|Women)\s+Open(\s+(Class|Seed))?$/i)
  if (open) {
    const gender: Gender = /^w/i.test(open[1]!) ? 'F' : 'M'
    return { gender, ageClass: `${gender}OP`, isOpenClass: true, scheme: 'five_year' }
  }

  // modern: 'Men Class 12 (80-84)', 'Women Class 13 (85+)'
  const modern = s.match(/^(Men|Women)\s+Class\s+(\d+)/i)
  if (modern) {
    const gender: Gender = /^w/i.test(modern[1]!) ? 'F' : 'M'
    const num = parseInt(modern[2]!, 10)
    return {
      gender,
      ageClass: `${gender}${String(num).padStart(2, '0')}`,
      isOpenClass: false,
      scheme: 'five_year',
    }
  }

  // legacy (through 2009): 'Men 80+', 'Women 70'
  const legacy = s.match(/^(Men|Women)\s+(\d{2})(\+?)$/i)
  if (legacy) {
    const gender: Gender = /^w/i.test(legacy[1]!) ? 'F' : 'M'
    return {
      gender,
      ageClass: `${gender}${legacy[2]}${legacy[3]}`,
      isOpenClass: false,
      scheme: 'ten_year',
    }
  }

  // legacy junior band, e.g. 'Men 18-20' — an explicit age range rather than a
  // decade. Appears once, in an early season.
  const range = s.match(/^(Men|Women)\s+(\d{2})-(\d{2})$/i)
  if (range) {
    const gender: Gender = /^w/i.test(range[1]!) ? 'F' : 'M'
    return {
      gender,
      ageClass: `${gender}${range[2]}-${range[3]}`,
      isOpenClass: false,
      scheme: 'ten_year',
    }
  }

  return null
}

export function parseAceResults(html: string): ParsedRace {
  const results: RaceResult[] = []
  const unparsedSections: string[] = []
  let scheme: AgeGroupScheme = 'five_year'
  let sawLegacy = false

  let current: ClassInfo | null = null
  let currentLabel = ''

  // Walk header and racer rows in document order.
  const rowRe = /<tr class="(groupHeader|racerEntry)"[^>]*>([\s\S]*?)<\/tr>/g

  for (const m of html.matchAll(rowRe)) {
    const kind = m[1]!
    const row = m[0]!
    const c = cells(row)

    if (kind === 'groupHeader') {
      const label = c.get('name') ?? ''
      if (!label) continue
      const info = parseClassLabel(label)
      if (info) {
        current = info
        currentLabel = decode(label)
        if (info.scheme === 'ten_year') sawLegacy = true
      } else {
        current = null
        currentLabel = decode(label)
        if (label.trim()) unparsedSections.push(decode(label))
      }
      continue
    }

    if (!current) continue // racer row outside a class we understand

    const name = c.get('name') ?? ''
    if (!name) continue

    const posRaw = (c.get('position') ?? '').trim()
    const publishedPosition = /^\d+$/.test(posRaw) ? parseInt(posRaw, 10) : null

    const run1 = c.has('run1') ? normalizeStatus(c.get('run1')!) : null
    const run2 = c.has('run2') ? normalizeStatus(c.get('run2')!) : null
    const result = normalizeStatus(c.get('result') ?? '')

    // ACE prints the authoritative total in `result`; trust it over re-adding runs.
    const totalSeconds = isNonFinish(result) ? null : timeToSeconds(result)

    const rpRaw = c.get('racePoints')
    const publishedRacePoints =
      rpRaw && rpRaw.trim() !== '' && !Number.isNaN(parseFloat(rpRaw))
        ? parseFloat(rpRaw)
        : null

    results.push({
      publishedPosition,
      // Open class names carry an age-class suffix: 'Hejna, Ethan (M01)'
      name: name.replace(/\s*\([MWF]\d+\)\s*$/, '').trim(),
      gender: current.gender,
      ageClass: current.ageClass,
      classLabel: currentLabel,
      isOpenClass: current.isOpenClass,
      run1,
      run2,
      result,
      totalSeconds,
      publishedRacePoints,
    })
  }

  if (sawLegacy) scheme = 'ten_year'
  return { results, ageGroupScheme: scheme, unparsedSections }
}

#!/usr/bin/env tsx
/**
 * Cup parity — does our handicap calculation reproduce the published cup results?
 * -----------------------------------------------------------------------------
 *
 * Published cup pages (`ES-<Cup><Year>-*.html`) conveniently carry everything the
 * check needs on one page:
 *
 *   1 | Crowell, Linda (W10) | 3:02.00 [3:54.84] | 2 | 2 | 1:57.44 (2) | 1:57.40 (2)
 *   ^position  ^name+class     ^handicap [raw]     St  Fn  ^per-race time (rank)
 *
 * So each row supplies the inputs (age class, per-race times) and the expected
 * outputs (handicapped combined, raw combined, position).
 *
 * Only age-handicapped cups are checked. The McKinney Cup is decided on raw time
 * and the pre-1997 Viva Italia had no formula at all — see migration/cup-rules.md.
 *
 * Usage:
 *   npm run cups
 *   npm run cups -- --verbose
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { calculateCup, HANDICAP_GS, HANDICAP_SL, type CupRacer } from '../src/cups.js'
import { timeToSeconds, truncateToHundredths } from '../src/time.js'
import type { Discipline, Gender } from '../src/types.js'

const ARCHIVE =
  process.env.FWM_ARCHIVE_DIR ||
  resolve(process.cwd(), '..', '..', 'fwm-results-archive')

const VERBOSE = process.argv.includes('--verbose')

/** Times are published to 0.01, so anything beyond half a hundredth is a real difference. */
const TIME_TOLERANCE = 0.005

/**
 * Handicap rate each cup was actually run at, which is configuration rather than
 * a rule (see src/cups.ts). Viva Italia has always used 3%; the Bernard Cup has
 * used 2.5% except in 2018 and 2020.
 *
 * In the application these live in `cups.handicap_rate`; here they let the harness
 * verify the *formula* given the correct configuration.
 */
function handicapRateFor(cupName: string, season: number): number {
  if (/vivaitalia/i.test(cupName)) return HANDICAP_SL
  if (/bernard/i.test(cupName)) return season === 2018 || season === 2020 ? HANDICAP_SL : HANDICAP_GS
  return HANDICAP_GS
}

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

/** Cells of one row as [class, text] pairs. */
function cells(row: string): Array<[string, string]> {
  return [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => [
    m[1]!.match(/class="([^"]+)"/)?.[1] ?? '',
    decode(m[2]!),
  ])
}

/**
 * Work out each paired race's discipline from the column headings
 * ("Palisades GS", "DiamondPeak SL"), since the handicap rate depends on it.
 */
function disciplinesFromHeader(headings: string[]): Discipline[] {
  return headings.map((h) => {
    const m = h.match(/\b(SL|GS|SG|DH|AC)\b/i)
    return (m ? m[1]!.toUpperCase() : 'GS') as Discipline
  })
}

interface Row {
  position: string
  name: string
  gender: Gender
  classNum: number
  hcpDisplay: string | null
  rawDisplay: string | null
  times: (number | null)[]
}

/** Parse one published cup page. */
function parseCupPage(html: string): { disciplines: Discipline[]; rows: Row[] } {
  let disciplines: Discipline[] = []
  let gender: Gender = 'F'
  const rows: Row[] = []

  const rowRe = /<tr class="(standingsHeader|groupHeader|racerEntry)"[^>]*>([\s\S]*?)<\/tr>/g

  for (const m of html.matchAll(rowRe)) {
    const kind = m[1]!
    const c = cells(m[0]!)

    if (kind === 'standingsHeader') {
      // Position | Competitor | Time | St | Fn | then one column per paired race
      disciplines = disciplinesFromHeader(c.slice(5).map(([, t]) => t))
      continue
    }

    if (kind === 'groupHeader') {
      // "All Women" / "All Men"
      const label = c.find(([cls]) => cls === 'name')?.[1] ?? c[1]?.[1] ?? ''
      if (/women/i.test(label)) gender = 'F'
      else if (/men/i.test(label)) gender = 'M'
      continue
    }

    const position = c.find(([cls]) => cls === 'position')?.[1] ?? ''
    const nameCell = c.find(([cls]) => cls === 'name')?.[1] ?? ''
    if (!nameCell) continue

    // The age class rides along in the name: "Crowell, Linda (W10)"
    const classMatch = nameCell.match(/\(([MWF])(\d+)\)\s*$/)
    if (!classMatch) continue
    const classNum = parseInt(classMatch[2]!, 10)
    const name = nameCell.replace(/\s*\([MWF]\d+\)\s*$/, '').trim()

    // Time cell reads "3:02.00 [3:54.84]" — handicapped, then raw in brackets.
    const timeCell = c.find(([cls]) => cls === 'score' || cls === 'result')?.[1] ?? c[2]?.[1] ?? ''
    const tm = timeCell.match(/^([\d:.]+)\s*\[([\d:.]+)\]$/)

    // Per-race cells read "1:57.44 (2)" — time and class rank.
    const times = c.slice(5).map(([, t]) => {
      const mm = t.match(/^([\d:.]+)/)
      return mm ? timeToSeconds(mm[1]!) : null
    })

    rows.push({
      position,
      name,
      gender,
      classNum,
      hcpDisplay: tm ? tm[1]! : null,
      rawDisplay: tm ? tm[2]! : null,
      times,
    })
  }

  return { disciplines, rows }
}

async function main() {
  const seasons = (await readdir(ARCHIVE, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => d.name)
    .sort()

  console.log('FWM cup parity — recomputed handicap vs published')
  console.log(`archive: ${ARCHIVE}\n`)
  console.log('season  cup file                                    racers   hcp time   raw time   position')
  console.log('------  ------------------------------------------  ------   --------   --------   --------')

  let gH = 0, gHok = 0, gR = 0, gRok = 0, gP = 0, gPok = 0
  const problems: string[] = []

  for (const season of seasons) {
    const dir = join(ARCHIVE, season)
    // Cup pages are the ES-* reports. McKinney is excluded: it is raw-combined,
    // not handicapped, so it does not test this code path.
    // Pre-2010 seasons used ten-year age groups, where "(W40)" means "woman in
    // her 40s" rather than "class 40". Those cups ran under a different handicap
    // scheme entirely and are display-only historical records (cup-rules.md), so
    // they are not a valid test of the current formula.
    if (parseInt(season, 10) < 2010) continue

    const files = (await readdir(dir)).filter(
      (f) => /^ES-/i.test(f) && /\.html$/i.test(f) && !/mckinney|silver/i.test(f)
    )

    for (const file of files) {
      const { disciplines, rows } = parseCupPage(await readFile(join(dir, file), 'latin1'))
      if (!rows.length) continue

      const racers: CupRacer[] = rows.map((r) => ({
        name: r.name,
        gender: r.gender,
        ageClassNumber: r.classNum,
        races: r.times.map((t, i) => ({
          discipline: disciplines[i] ?? 'GS',
          totalSeconds: t,
          classRank: null,
        })),
      }))

      const computed = calculateCup(
        racers,
        'age_handicap',
        handicapRateFor(file, parseInt(season, 10))
      )
      const byName = new Map(computed.map((c) => [`${c.gender}|${c.name}`, c]))

      let h = 0, hok = 0, rw = 0, rok = 0, p = 0, pok = 0

      for (const pub of rows) {
        const ours = byName.get(`${pub.gender}|${pub.name}`)
        if (!ours) continue

        if (pub.hcpDisplay) {
          h++
          const want = timeToSeconds(pub.hcpDisplay)
          // Compare truncated-to-hundredths, because that is how ACE prints times.
          if (ours.combinedHandicap !== null && want !== null &&
              Math.abs(truncateToHundredths(ours.combinedHandicap) - want) <= TIME_TOLERANCE) hok++
          else problems.push(`${season} ${file} ${pub.name}: hcp ours=${ours.combinedHandicapDisplay} pub=${pub.hcpDisplay}`)
        }
        if (pub.rawDisplay) {
          rw++
          const want = timeToSeconds(pub.rawDisplay)
          if (ours.combinedRaw !== null && want !== null &&
              Math.abs(truncateToHundredths(ours.combinedRaw) - want) <= TIME_TOLERANCE) rok++
          else problems.push(`${season} ${file} ${pub.name}: raw ours=${ours.combinedRawDisplay} pub=${pub.rawDisplay}`)
        }
        p++
        if (ours.position === pub.position) pok++
        else problems.push(`${season} ${file} ${pub.name}: pos ours=${ours.position} pub=${pub.position}`)
      }

      gH += h; gHok += hok; gR += rw; gRok += rok; gP += p; gPok += pok
      const pc = (ok: number, all: number) => (all ? `${((ok / all) * 100).toFixed(1)}%`.padStart(7) : '    n/a')
      console.log(
        `${season}  ${file.slice(0, 42).padEnd(42)}  ${String(rows.length).padStart(6)}   ` +
          `${pc(hok, h)}    ${pc(rok, rw)}    ${pc(pok, p)}`
      )
    }
  }

  const pc = (ok: number, all: number) => (all === 0 ? 'n/a' : `${((ok / all) * 100).toFixed(1)}%`)
  console.log(`\nTOTAL`)
  console.log(`  handicap time:  ${pc(gHok, gH)}  (${gHok}/${gH})`)
  console.log(`  raw time     :  ${pc(gRok, gR)}  (${gRok}/${gR})`)
  console.log(`  position     :  ${pc(gPok, gP)}  (${gPok}/${gP})`)

  if (VERBOSE && problems.length) {
    console.log(`\n--- mismatches (${problems.length}) ---`)
    for (const p of problems.slice(0, 50)) console.log('  ' + p)
    if (problems.length > 50) console.log(`  ... and ${problems.length - 50} more`)
  } else if (problems.length) {
    console.log(`\n  ${problems.length} mismatches (run with --verbose to list)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

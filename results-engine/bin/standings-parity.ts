#!/usr/bin/env tsx
/**
 * Standings parity — does our best-N and tie logic reproduce the published standings?
 * ---------------------------------------------------------------------------------
 *
 * Reads each season's published standings page, rebuilds every racer's season from
 * the per-race cells printed on that same page, then runs our standings module over
 * it and compares four published values: total points, starts, finishes, and class
 * rank (including "(t)" tie notation).
 *
 * This isolates the aggregation logic. Race-level scoring — class rank and race
 * points — is verified separately and end-to-end by `npm run parity`.
 *
 * Usage:
 *   npm run standings                    # every archived season
 *   npm run standings -- --season 2026
 *   npm run standings -- --verbose       # list mismatches
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseStandings, type StandingRow } from '../src/parseStandings.js'
import { bestNForSeason, rankStandings, type SeasonRacer } from '../src/standings.js'

const ARCHIVE =
  process.env.FWM_ARCHIVE_DIR ||
  resolve(process.cwd(), '..', '..', 'fwm-results-archive')

const argv = process.argv.slice(2)
const VERBOSE = argv.includes('--verbose')
const ONLY_SEASON = argv.includes('--season') ? argv[argv.indexOf('--season') + 1] : undefined

/**
 * Starts and finishes, following the rule documented in the Airtable base:
 *   a start   = the racer has a cell for that race and it isn't DNS
 *   a finish  = the racer has a cell and it records no 'D' status at all
 */
function startedAndFinished(cell: StandingRow['cells'][number]) {
  const hasEntry = cell.points !== null || cell.status !== null
  if (!hasEntry) return { started: false, finished: false }
  const status = cell.status ?? ''
  return {
    started: status !== 'DNS',
    finished: status === '', // scored, no DNF/DNS/DSQ
  }
}

/** Rebuild the inputs to our standings module from a published page. */
function toSeasonRacers(rows: StandingRow[]): SeasonRacer[] {
  return rows.map((r) => ({
    name: r.name,
    // Open class racers are ranked separately from age classes, so the scoring
    // class must distinguish them even when the age class code is the same.
    scoringClass: r.isOpenClass ? `OPEN:${r.gender}` : `AGE:${r.ageClass}`,
    entries: r.cells.map((c) => ({
      raceIndex: c.raceIndex,
      points: c.points,
      ...startedAndFinished(c),
    })),
  }))
}

async function main() {
  const seasons = (await readdir(ARCHIVE, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => d.name)
    .filter((s) => !ONLY_SEASON || s === ONLY_SEASON)
    .sort()

  console.log('FWM standings parity — recomputed vs published')
  console.log(`archive: ${ARCHIVE}\n`)
  console.log('season  racers   total pts        rank          starts        finishes')
  console.log('------  ------   -------------    ----------    ----------    ----------')

  let gTotal = 0, gTotalOk = 0
  let gRank = 0, gRankOk = 0
  let gSt = 0, gStOk = 0
  let gFn = 0, gFnOk = 0
  const problems: string[] = []

  for (const season of seasons) {
    const dir = join(ARCHIVE, season)
    const files = (await readdir(dir)).filter((f) => /^SS-.*ByClass\.html$/i.test(f))
    if (!files.length) {
      console.log(`${season}   (no standings page)`)
      continue
    }

    const { raceColumns, rows } = parseStandings(await readFile(join(dir, files[0]!), 'latin1'))
    if (!rows.length) {
      console.log(`${season}   (parsed 0 rows)`)
      continue
    }

    // Pass the season so any recorded best-N override (e.g. covid-shortened 2021)
    // is applied instead of the standard 75% formula.
    const computed = rankStandings(toSeasonRacers(rows), raceColumns.length, parseInt(season, 10))

    // Index our results so they can be compared against the published rows.
    // Name + scoring class is unique within a season's standings.
    const byKey = new Map(computed.map((c) => [`${c.scoringClass}|${c.name}`, c]))

    let tOk = 0, rOk = 0, sOk = 0, fOk = 0
    for (const pub of rows) {
      const key = `${pub.isOpenClass ? `OPEN:${pub.gender}` : `AGE:${pub.ageClass}`}|${pub.name}`
      const ours = byKey.get(key)
      if (!ours) continue

      if (ours.totalPoints === pub.totalPoints) tOk++
      else if (VERBOSE) problems.push(`${season} ${pub.name} [${pub.classLabel}] total: ours=${ours.totalPoints} pub=${pub.totalPoints}`)

      if (ours.classRank === pub.position) rOk++
      else if (VERBOSE) problems.push(`${season} ${pub.name} [${pub.classLabel}] rank: ours=${ours.classRank} pub=${pub.position}`)

      if (ours.starts === pub.starts) sOk++
      else if (VERBOSE) problems.push(`${season} ${pub.name} [${pub.classLabel}] starts: ours=${ours.starts} pub=${pub.starts}`)

      if (ours.finishes === pub.finishes) fOk++
      else if (VERBOSE) problems.push(`${season} ${pub.name} [${pub.classLabel}] finishes: ours=${ours.finishes} pub=${pub.finishes}`)
    }

    const n = rows.length
    gTotal += n; gTotalOk += tOk
    gRank += n; gRankOk += rOk
    gSt += n; gStOk += sOk
    gFn += n; gFnOk += fOk

    const p = (ok: number) => `${((ok / n) * 100).toFixed(1)}%`.padStart(6)
    console.log(
      `${season}  ${String(n).padStart(6)}   ${p(tOk)} (${tOk}/${n})`.padEnd(38) +
        `${p(rOk)}`.padEnd(14) + `${p(sOk)}`.padEnd(14) + `${p(fOk)}` +
        `   [best ${bestNForSeason(raceColumns.length, parseInt(season, 10))} of ${raceColumns.length}]`
    )
  }

  const pc = (ok: number, all: number) => (all === 0 ? 'n/a' : `${((ok / all) * 100).toFixed(1)}%`)
  console.log(`\nTOTAL across ${gTotal} racer-seasons`)
  console.log(`  total points:  ${pc(gTotalOk, gTotal)}  (${gTotalOk}/${gTotal})`)
  console.log(`  class rank  :  ${pc(gRankOk, gRank)}  (${gRankOk}/${gRank})`)
  console.log(`  starts      :  ${pc(gStOk, gSt)}  (${gStOk}/${gSt})`)
  console.log(`  finishes    :  ${pc(gFnOk, gFn)}  (${gFnOk}/${gFn})`)

  if (VERBOSE && problems.length) {
    console.log(`\n--- mismatches (${problems.length}) ---`)
    for (const p of problems.slice(0, 60)) console.log('  ' + p)
    if (problems.length > 60) console.log(`  ... and ${problems.length - 60} more`)
  } else if (problems.length === 0 && !VERBOSE) {
    console.log('\n  (run with --verbose to list any mismatches)')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

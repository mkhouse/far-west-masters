#!/usr/bin/env tsx
/**
 * Parity report — does our engine reproduce the official FWM results?
 * ------------------------------------------------------------------
 *
 * For every archived race, this recomputes class ranks and race points from the
 * published run times, then compares them against the numbers ACE Scoring itself
 * printed in the very same file.
 *
 * That makes each published results file a self-contained test case: it holds both
 * the inputs (run times) and the expected outputs (position, race points). Nothing
 * has to be requested from anyone, and the evidence is reproducible by anybody who
 * can read the public site.
 *
 * Both compared quantities are independent of the class-points scale, so the report
 * stays valid across every scoring era including pre-2016 seasons.
 *
 * Usage:
 *   npm run parity                        # every archived season
 *   npm run parity -- --season 2026       # a single season
 *   npm run parity -- --verbose           # list every mismatch
 *   npm run parity -- --out ../report.md  # also write a markdown report
 *
 * Requires the local mirror created by `node migration/archive-results.mjs --all`.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname, basename } from 'node:path'
import { parseAceResults } from '../src/parseAce.js'
import { calculateScoring } from '../src/scoring.js'
import { factorsForSeason, pointsScaleForSeason, type Discipline } from '../src/types.js'

/** Local mirror of the published results (kept outside the repo — see migration/). */
const ARCHIVE =
  process.env.FWM_ARCHIVE_DIR ||
  resolve(process.cwd(), '..', '..', 'fwm-results-archive')

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const has = (flagName: string) => argv.includes(flagName)
const val = (flagName: string) => {
  const i = argv.indexOf(flagName)
  return i !== -1 ? argv[i + 1] : undefined
}

const VERBOSE = has('--verbose')
const ONLY_SEASON = val('--season')
const OUT = val('--out')

/**
 * Race points are published to 2dp, so anything within half a cent is a match.
 *
 * A handful of results sit within ~0.0001 of a rounding boundary. ACE computes from
 * the timing system's full precision but publishes times rounded to hundredths, so
 * for those we cannot reproduce the final cent from published data alone. That is a
 * limit of the input, not a disagreement about the formula.
 */
const POINTS_TOLERANCE = 0.005

const DISCIPLINES = new Set<Discipline>(['SL', 'GS', 'SG', 'DH', 'AC'])

/**
 * Pull the discipline out of a results filename, e.g.
 *   20260307-Palisades-GS-BernardCup-1of2-ByClass.html  ->  GS
 * Matches whole hyphen-separated tokens only, so 'GS2' in a rescheduled-race
 * filename is not mistaken for the discipline.
 */
function disciplineFromFilename(file: string): Discipline | null {
  for (const part of basename(file, '.html').split('-')) {
    const token = part.toUpperCase() as Discipline
    if (DISCIPLINES.has(token)) return token
  }
  return null
}

/** A single disagreement between our computation and the published value. */
interface Mismatch {
  race: string
  name: string
  classLabel: string
  kind: 'rank' | 'points'
  ours: string
  published: string
}

/** Per-race tally of how our numbers compared to the published ones. */
interface RaceReport {
  season: string
  file: string
  discipline: Discipline
  factor: number
  competitors: number
  finishers: number
  rankChecks: number
  rankMatches: number
  pointsChecks: number
  pointsMatches: number
  mismatches: Mismatch[]
  unparsed: string[]
}

/**
 * Recompute one race and compare against its published values.
 * Returns null when the file isn't a race (no discipline in the name).
 */
async function checkRace(
  season: string,
  dir: string,
  file: string
): Promise<RaceReport | null> {
  const discipline = disciplineFromFilename(file)
  if (!discipline) return null

  // These pages are ISO-8859-1, not UTF-8 — decoding as UTF-8 mangles accented names.
  const html = await readFile(join(dir, file), 'latin1')
  const { results, unparsedSections } = parseAceResults(html)

  // Scoring rules are per-season: discipline factors have been revised five times
  // since 2009, so using today's values on an old race produces wrong race points
  // from entirely correct logic.
  const seasonYear = parseInt(season, 10)
  const factor = factorsForSeason(seasonYear)[discipline]
  const pointsScale = pointsScaleForSeason(seasonYear)

  const base = {
    season, file, discipline, factor,
    competitors: results.length,
    finishers: results.filter((r) => r.totalSeconds !== null).length,
    unparsed: unparsedSections,
  }

  // A file that yields nothing is a parser gap, not a pass — report it as such.
  if (!results.length) {
    return { ...base, rankChecks: 0, rankMatches: 0, pointsChecks: 0, pointsMatches: 0, mismatches: [] }
  }

  const scored = calculateScoring(results, factor, pointsScale)

  let rankChecks = 0
  let rankMatches = 0
  let pointsChecks = 0
  let pointsMatches = 0
  const mismatches: Mismatch[] = []

  for (const r of scored) {
    // Compare finishing position within the class. Only meaningful where both
    // sides produced one (non-finishers have neither).
    if (r.publishedPosition !== null && r.classRank !== null) {
      rankChecks++
      if (r.publishedPosition === r.classRank) {
        rankMatches++
      } else {
        mismatches.push({
          race: file, name: r.name, classLabel: r.classLabel, kind: 'rank',
          ours: String(r.classRank), published: String(r.publishedPosition),
        })
      }
    }

    // Compare race points to the published precision.
    if (r.publishedRacePoints !== null && r.racePoints !== null) {
      pointsChecks++
      if (Math.abs(r.publishedRacePoints - r.racePoints) <= POINTS_TOLERANCE) {
        pointsMatches++
      } else {
        mismatches.push({
          race: file, name: r.name, classLabel: r.classLabel, kind: 'points',
          ours: r.racePoints.toFixed(2), published: r.publishedRacePoints.toFixed(2),
        })
      }
    }
  }

  return { ...base, rankChecks, rankMatches, pointsChecks, pointsMatches, mismatches }
}

/** Percentage helper that stays readable when there is nothing to compare. */
const pct = (n: number, d: number) => (d === 0 ? '  n/a ' : `${((n / d) * 100).toFixed(1)}%`)

async function main() {
  // Season folders are named by the season's ending year (2026 = 2025-26 season).
  const seasons = (await readdir(ARCHIVE, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => d.name)
    .filter((s) => !ONLY_SEASON || s === ONLY_SEASON)
    .sort()

  if (!seasons.length) {
    console.error(`No archived seasons found in ${ARCHIVE}`)
    console.error('Run: node migration/archive-results.mjs --all')
    process.exit(1)
  }

  const reports: RaceReport[] = []

  console.log('FWM parity report — recomputed vs published (ACE Scoring)')
  console.log(`archive: ${ARCHIVE}\n`)
  console.log('season   races   racers    rank match        race-point match')
  console.log('------   -----   ------    --------------    ----------------')

  for (const season of seasons) {
    const dir = join(ARCHIVE, season)

    // Only the by-class race files. SS- (season standings) and ES- (cup results)
    // are different report types and are checked separately.
    const files = (await readdir(dir))
      .filter((f) => /ByClass\.html$/i.test(f) && !/^(SS|ES)-/i.test(f))
      .sort()

    const seasonReports: RaceReport[] = []
    for (const f of files) {
      const r = await checkRace(season, dir, f)
      if (r) seasonReports.push(r)
    }
    reports.push(...seasonReports)

    const sum = (k: keyof RaceReport) =>
      seasonReports.reduce((a, r) => a + (r[k] as number), 0)
    const rc = sum('rankChecks'), rm = sum('rankMatches')
    const pc = sum('pointsChecks'), pm = sum('pointsMatches')

    console.log(
      `${season}   ${String(seasonReports.length).padStart(5)}   ` +
        `${String(sum('competitors')).padStart(6)}    ` +
        `${pct(rm, rc)} ${`(${rm}/${rc})`.padEnd(14)} ` +
        `${pct(pm, pc)} (${pm}/${pc})`
    )
  }

  // ---- overall totals ----
  const tot = (k: keyof RaceReport) => reports.reduce((a, r) => a + (r[k] as number), 0)
  const rc = tot('rankChecks'), rm = tot('rankMatches')
  const pc = tot('pointsChecks'), pm = tot('pointsMatches')
  const allMismatches = reports.flatMap((r) => r.mismatches)

  console.log(`\nTOTAL: ${reports.length} races, ${tot('competitors')} results`)
  console.log(`  class rank :  ${pct(rm, rc)}  (${rm}/${rc})`)
  console.log(`  race points:  ${pct(pm, pc)}  (${pm}/${pc})`)
  console.log(`  mismatches :  ${allMismatches.length}`)

  // Files that parsed to nothing indicate an unhandled format, which would
  // otherwise look like a perfect score on zero checks.
  const emptyRaces = reports.filter((r) => r.competitors === 0)
  if (emptyRaces.length) {
    console.log(`\n  ${emptyRaces.length} race file(s) parsed to zero results:`)
    for (const r of emptyRaces.slice(0, 10)) console.log(`    ${r.season}/${r.file}`)
    if (emptyRaces.length > 10) console.log(`    ... and ${emptyRaces.length - 10} more`)
  }

  // Section headers we didn't recognize — usually a class type from an older era.
  const unparsed = new Set(reports.flatMap((r) => r.unparsed))
  if (unparsed.size) {
    console.log(`\n  unrecognized section headers (${unparsed.size}):`)
    for (const u of [...unparsed].slice(0, 15)) console.log(`    "${u}"`)
  }

  if (VERBOSE && allMismatches.length) {
    console.log('\n--- mismatches ---')
    for (const m of allMismatches.slice(0, 200)) {
      console.log(
        `  ${m.race}\n    ${m.name} [${m.classLabel}] ${m.kind}: ` +
          `ours=${m.ours} published=${m.published}`
      )
    }
    if (allMismatches.length > 200) {
      console.log(`  ... and ${allMismatches.length - 200} more`)
    }
  } else if (allMismatches.length) {
    console.log('\n  (run with --verbose to list them)')
  }

  if (OUT) {
    await mkdir(dirname(resolve(OUT)), { recursive: true })
    await writeFile(resolve(OUT), renderMarkdown(reports, seasons))
    console.log(`\nWrote ${resolve(OUT)}`)
  }
}

/** Render the same findings as a shareable markdown document. */
function renderMarkdown(reports: RaceReport[], seasons: string[]): string {
  const L: string[] = []
  L.push('# FWM parity report', '')
  L.push('Class ranks and race points recomputed from the published run times, then')
  L.push('compared against the values ACE Scoring printed in the same file.', '')
  L.push('| season | races | results | class rank | race points | factors used |')
  L.push('|---|---:|---:|---:|---:|---|')

  for (const s of seasons) {
    const rs = reports.filter((r) => r.season === s)
    if (!rs.length) continue
    const sum = (k: keyof RaceReport) => rs.reduce((a, r) => a + (r[k] as number), 0)
    // Show which discipline factors this season was scored with.
    const f = factorsForSeason(parseInt(s, 10))
    L.push(
      `| ${s} | ${rs.length} | ${sum('competitors')} | ` +
        `${pct(sum('rankMatches'), sum('rankChecks'))} | ` +
        `${pct(sum('pointsMatches'), sum('pointsChecks'))} | ` +
        `SL ${f.SL} / GS ${f.GS} / SG ${f.SG} |`
    )
  }

  const all = reports.flatMap((r) => r.mismatches)
  L.push('', `**Mismatches: ${all.length}**`, '')
  if (all.length) {
    L.push('| race | competitor | class | field | ours | published |')
    L.push('|---|---|---|---|---:|---:|')
    for (const m of all.slice(0, 300)) {
      L.push(
        `| ${m.race} | ${m.name} | ${m.classLabel} | ${m.kind} | ${m.ours} | ${m.published} |`
      )
    }
  }
  return L.join('\n') + '\n'
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

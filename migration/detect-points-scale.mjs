#!/usr/bin/env node
/**
 * Detect the class-points scale used in each season, empirically.
 *
 * The published season standings encode every scoring event as
 *     <td class="rsScore">100 (1)</td>      // points (class rank)
 * so the rank -> points mapping for a season can simply be read off the file.
 * That means we don't have to *remember* when the points scale changed; we can
 * measure it, for every season in the archive.
 *
 * Reports:
 *   - the observed scale per season
 *   - any season where one rank maps to two different point values (a red flag:
 *     either a mid-season rule change, a tie convention, or a parsing bug)
 *   - the exact seasons where the scale changes
 *
 * Usage:
 *   node migration/detect-points-scale.mjs
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ARCHIVE =
  process.env.FWM_ARCHIVE_DIR || resolve(process.cwd(), '..', 'fwm-results-archive')

// The reference scale currently implemented in parseResults.ts.
const CURRENT_SCALE = [
  100, 80, 60, 50, 45, 40, 36, 32, 29, 26,
  24, 22, 20, 18, 16, 15, 14, 13, 12, 11,
  10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
]

/**
 * Read every scoring event out of a season's standings pages.
 *
 * Each per-race cell is printed as `points (rank)`, so a season's whole rank ->
 * points mapping can be read straight off the published files. Counts are kept
 * per value so a genuine scale can be told apart from a stray typo.
 */
async function scaleForSeason(dir) {
  const files = (await readdir(dir)).filter((f) => /^SS-.*\.html$/i.test(f))
  const observed = new Map() // rank -> Map(points -> count)

  for (const f of files) {
    const html = await readFile(join(dir, f), 'latin1')
    for (const m of html.matchAll(/<td class="rsScore">\s*(\d+)\s*\((\d+)\)\s*<\/td>/g)) {
      const points = parseInt(m[1], 10)
      const rank = parseInt(m[2], 10)
      if (!observed.has(rank)) observed.set(rank, new Map())
      const byPoints = observed.get(rank)
      byPoints.set(points, (byPoints.get(points) ?? 0) + 1)
    }
  }
  return { observed, fileCount: files.length }
}

/**
 * Reduce the observations to one scale, flagging any rank that was seen with more
 * than one point value — which would mean a mid-season change, a tie convention,
 * or a parsing bug, and should never pass silently.
 */
function summarize(observed) {
  const scale = []
  const conflicts = []
  const maxRank = Math.max(0, ...observed.keys())

  for (let rank = 1; rank <= maxRank; rank++) {
    const byPoints = observed.get(rank)
    if (!byPoints) {
      scale.push(null) // nobody finished in this position all season
      continue
    }
    // Sort by frequency so an outlier can't outvote the real value.
    const entries = [...byPoints.entries()].sort((a, b) => b[1] - a[1])
    scale.push(entries[0][0]) // most common value wins
    if (entries.length > 1) {
      conflicts.push({
        rank,
        values: entries.map(([p, n]) => `${p}×${n}`).join(', '),
      })
    }
  }
  return { scale, conflicts }
}

const fmt = (scale) =>
  scale.map((p) => (p === null ? '·' : p)).join(', ')

/**
 * Compare two scales by *scoring depth and values*, treating a missing entry and
 * an explicit 0 as the same thing: ranks past the scoring cutoff earn nothing, and
 * how deep the results happened to go that season is noise, not a rule change.
 */
function firstDifference(a, b) {
  const at = (arr, i) => (arr[i] == null ? 0 : arr[i])
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (at(a, i) !== at(b, i)) return { rank: i + 1, from: at(a, i), to: at(b, i) }
  }
  return null
}

async function main() {
  const seasons = (await readdir(ARCHIVE, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => d.name)
    .sort()

  if (!seasons.length) {
    console.error(`No season folders in ${ARCHIVE}. Run archive-results.mjs first.`)
    process.exit(1)
  }

  console.log(`Points scale by season  (archive: ${ARCHIVE})\n`)

  const results = []
  for (const season of seasons) {
    const { observed, fileCount } = await scaleForSeason(join(ARCHIVE, season))
    if (!observed.size) {
      console.log(`${season}: no standings data (${fileCount} SS-* files)`)
      continue
    }
    const { scale, conflicts } = summarize(observed)
    results.push({ season, scale, conflicts })

    console.log(`${season}:  ${fmt(scale.slice(0, 30))}`)
    if (scale.length > 30) console.log(`        (+${scale.length - 30} deeper places)`)
    for (const c of conflicts) {
      console.log(`        ⚠ rank ${c.rank} maps to multiple values: ${c.values}`)
    }
  }

  // Where does the scale actually change?
  console.log('\n--- changes between consecutive seasons ---')
  let changes = 0
  for (let i = 1; i < results.length; i++) {
    const d = firstDifference(results[i - 1].scale, results[i].scale)
    if (d) {
      changes++
      console.log(
        `${results[i - 1].season} → ${results[i].season}: ` +
          (d.rank
            ? `rank ${d.rank} was ${d.from}, now ${d.to}`
            : `depth changed: ${d.from} → ${d.to}`)
      )
    }
  }
  if (!changes) console.log('none — the scale is identical across every archived season')

  // How does the newest season compare to what the engine implements?
  const latest = results[results.length - 1]
  if (latest) {
    const d = firstDifference(CURRENT_SCALE, latest.scale)
    console.log(`\n--- parseResults.ts WC_POINTS vs ${latest.season} ---`)
    console.log(
      d
        ? `MISMATCH: ${d.rank ? `rank ${d.rank}: engine says ${d.from}, published says ${d.to}` : `${d.from} vs ${d.to}`}`
        : 'match (for every rank observed in the published standings)'
    )
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})

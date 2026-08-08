#!/usr/bin/env node
/**
 * FWM published-results archiver
 * ------------------------------
 * Mirrors the official race results, cup results, and season standings that
 * ACE Scoring publishes to classic.farwestmasters.org.
 *
 * Why: these files are the ground truth for the parity project — each race file
 * contains ACE's own computed race points and placements, so our engine can be
 * checked against it directly. We mirror once and then hit our local copy as
 * much as we like, instead of hammering a small volunteer-run site.
 *
 * Politeness: one request per second by default, a descriptive user-agent, and
 * already-cached files are skipped. Re-running is nearly free.
 *
 * Usage:
 *   node migration/archive-results.mjs                 # last 3 seasons
 *   node migration/archive-results.mjs --seasons 2026  # specific season(s)
 *   node migration/archive-results.mjs --all           # every season, 2009+
 *   node migration/archive-results.mjs --delay 2000    # slower, extra polite
 *
 * Output (outside this repo):
 *   ../fwm-results-archive/<season>/<filename>.html
 *   ../fwm-results-archive/manifest.json
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'

const HOST = 'https://classic.farwestmasters.org'
const UA = 'FWM-parity-archiver/1.0 (Far West Masters results migration; +github.com/mkhouse/far-west-masters)'

const OUT_ROOT =
  process.env.FWM_ARCHIVE_DIR || resolve(process.cwd(), '..', 'fwm-results-archive')

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, fallback) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}

const DELAY = parseInt(opt('--delay', '1000'), 10) // ms between requests
const CURRENT_SEASON = 2026

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// fetching (polite + cached)
// ---------------------------------------------------------------------------
let fetched = 0
let skipped = 0

/** Does this path already exist? Used to skip files we've already mirrored. */
async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Fetch a page from the classic site, backing off on server errors.
 * Returns null for 404 (some seasons genuinely lack some reports).
 */
async function get(path) {
  const url = path.startsWith('http') ? path : HOST + path
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (res.ok) {
      await sleep(DELAY)
      fetched++
      // These pages are iso-8859-1, not utf-8.
      const buf = Buffer.from(await res.arrayBuffer())
      return new TextDecoder('iso-8859-1').decode(buf)
    }
    if (res.status === 404) return null
    await sleep(DELAY * (attempt + 2)) // back off on 5xx / rate limiting
  }
  console.warn(`  ! gave up on ${url}`)
  return null
}

/** Fetch a report file, using the local copy when we already have it. */
async function getCached(path, destPath) {
  if (await exists(destPath)) {
    skipped++
    return readFile(destPath, 'utf8')
  }
  const html = await get(path)
  if (html !== null) await writeFile(destPath, html, 'utf8')
  return html
}

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------
/** Every href on a page. Crude but sufficient for this static, hand-built site. */
function hrefs(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
}

/**
 * Find every season with published results by reading the archive index, rather
 * than assuming a contiguous year range — some seasons are missing (2002-2008 are
 * listed as temporarily unavailable) and the current season isn't listed there.
 */
async function discoverSeasons() {
  const html = await get('/raceinfo/archives')
  if (!html) return [CURRENT_SEASON]
  const years = new Set([CURRENT_SEASON])
  for (const h of hrefs(html)) {
    const m = h.match(/^(\d{4})\/results$/)
    if (m) years.add(parseInt(m[1], 10))
  }
  return [...years].sort((a, b) => a - b)
}

/**
 * All report files linked from one season's results index: individual races
 * (three views each), cup results, and the season standings.
 * De-duplicated because a race is linked once per view.
 */
async function discoverReports(season) {
  const html = await get(`/raceinfo/${season}/results`)
  if (!html) return []
  return [...new Set(hrefs(html).filter((h) => /^\/reports\/results\//i.test(h)))]
}

// ---------------------------------------------------------------------------
// filename → race metadata
//   20260307-Palisades-GS-BernardCup-1of2-ByClass.html
//   20260227-Northstar-SG-nss-1of2-ByGender.html
//   SS-BestNFinishes-ByClass.html
//   ES-BernardCup2026-BernardCup-ByGender.html
// ---------------------------------------------------------------------------
const DISCIPLINES = new Set(['SL', 'GS', 'SG', 'DH', 'AC'])
const VIEWS = new Set(['ByClass', 'ByGender', 'Overall'])

function parseReportName(file) {
  const stem = basename(file, '.html')
  const parts = stem.split('-')

  const view = VIEWS.has(parts[parts.length - 1]) ? parts.pop() : null

  // Season standings: SS-BestNFinishes-*
  if (parts[0] === 'SS') {
    return { kind: 'standings', view, label: parts.slice(1).join('-') }
  }
  // Event summary / cup results: ES-<CupName><Year>-*
  if (parts[0] === 'ES') {
    return { kind: 'cup', view, label: parts.slice(1).join('-') }
  }

  // Race results
  const dateRaw = parts.shift() ?? ''
  const date = /^\d{8}$/.test(dateRaw)
    ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
    : null
  if (!date) return { kind: 'unknown', view, label: stem }

  const venue = parts.shift() ?? null
  const discipline = DISCIPLINES.has(parts[0]) ? parts.shift() : null

  let sequence = null
  const tags = []
  for (const p of parts) {
    if (/^\d+of\d+$/i.test(p)) sequence = p
    else tags.push(p)
  }

  return { kind: 'race', view, date, venue, discipline, sequence, tags }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT_ROOT, { recursive: true })

  let seasons
  if (flag('--all')) {
    seasons = await discoverSeasons()
  } else if (opt('--seasons', null)) {
    seasons = opt('--seasons', '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter(Boolean)
  } else {
    seasons = [CURRENT_SEASON - 2, CURRENT_SEASON - 1, CURRENT_SEASON]
  }

  console.log(`Archiving seasons: ${seasons.join(', ')}`)
  console.log(`Destination: ${OUT_ROOT}`)
  console.log(`Delay: ${DELAY}ms between requests\n`)

  const manifest = { archivedAt: new Date().toISOString(), source: HOST, seasons: [] }

  for (const season of seasons) {
    const dir = join(OUT_ROOT, String(season))
    await mkdir(dir, { recursive: true })
    process.stdout.write(`# ${season} … `)

    const reports = await discoverReports(season)
    if (!reports.length) {
      console.log('no results index (season may predate this layout)')
      manifest.seasons.push({ season, files: [] })
      continue
    }
    console.log(`${reports.length} files`)

    const files = []
    for (const path of reports) {
      const name = basename(path)
      const dest = join(dir, name)
      const had = await exists(dest)
      const html = await getCached(path, dest)
      if (html === null) {
        console.log(`  ! missing: ${name}`)
        continue
      }
      const meta = parseReportName(name)
      files.push({ file: name, path, bytes: html.length, ...meta })
      if (!had) console.log(`  + ${name}`)
    }

    // Summarise what we got, so gaps are obvious.
    const races = new Set(
      files.filter((f) => f.kind === 'race').map((f) => `${f.date}|${f.sequence ?? ''}`)
    )
    console.log(
      `  → ${races.size} races, ` +
        `${files.filter((f) => f.kind === 'cup').length} cup files, ` +
        `${files.filter((f) => f.kind === 'standings').length} standings files\n`
    )
    manifest.seasons.push({ season, files })
  }

  await writeFile(join(OUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`Done. fetched ${fetched}, reused from cache ${skipped}.`)
  console.log(`Manifest: ${join(OUT_ROOT, 'manifest.json')}`)
}

main().catch((e) => {
  console.error('\nArchive failed:', e.message)
  process.exit(1)
})

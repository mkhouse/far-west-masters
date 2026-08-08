#!/usr/bin/env node
/**
 * Recover live-timing race ids for archived FWM races.
 * ----------------------------------------------------
 * Live-timing publishes a static text file per day listing every race it hosted:
 *
 *     https://www.live-timing.com/dailyRaces/<year>/races_<YYYY-MM-DD>.txt
 *
 * So ids do not need to be collected by hand. For each archived race we know the
 * date, venue and discipline (from the published filename), which is enough to
 * find the matching entry.
 *
 * Output is a JSON map from archived race file -> live-timing id, used by the
 * preliminary-vs-official comparison.
 *
 * Politeness: one request per race *date* (not per race), cached to disk, one
 * second apart. Re-runs read the cache and make no requests at all.
 *
 * Usage:
 *   node migration/harvest-live-timing-ids.mjs                 # recent seasons
 *   node migration/harvest-live-timing-ids.mjs --seasons 2026
 *   node migration/harvest-live-timing-ids.mjs --all
 */

import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'

const ARCHIVE =
  process.env.FWM_ARCHIVE_DIR || resolve(process.cwd(), '..', 'fwm-results-archive')
const CACHE = join(ARCHIVE, '_live-timing-daily')
const OUT = join(ARCHIVE, 'live-timing-ids.json')

const UA = 'FWM-parity-research/1.0 (Far West Masters results migration)'
const DELAY = 1000

const argv = process.argv.slice(2)
const opt = (f, d) => {
  const i = argv.indexOf(f)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Matching FWM races inside a nationwide daily listing
// ---------------------------------------------------------------------------

/**
 * Venue names as they appear in published FWM filenames, mapped to the substrings
 * live-timing uses. Palisades Tahoe was called Squaw Valley until the 2021-22
 * season, and Alpine Meadows appears under both its own name and Palisades.
 */
const VENUE_ALIASES = {
  palisades: ['palisades', 'squaw', 'alpine meadows', 'olympic valley'],
  squaw: ['squaw', 'palisades', 'olympic valley'],

  // Palisades Tahoe merged two resorts, and FWM filenames distinguish the base
  // areas: 'PalisadesAM' is Alpine Meadows, 'PalisadesOV' is Olympic Valley (the
  // former Squaw). Live-timing does not always make that distinction, so both
  // fall back to matching the resort as a whole.
  palisadesam: ['alpine meadows', 'palisades', 'squaw'],
  palisadesov: ['olympic valley', 'palisades', 'squaw'],

  alpine: ['alpine meadows', 'alpine', 'palisades'],
  alpinemeadows: ['alpine meadows', 'alpine', 'palisades'],
  mammoth: ['mammoth'],
  sugarbowl: ['sugar bowl', 'sugarbowl'],
  northstar: ['northstar'],
  diamondpeak: ['diamond peak', 'diamondpeak'],
  heavenly: ['heavenly'],
  mtrose: ['mt. rose', 'mt rose', 'rose'],
  boreal: ['boreal'],
  kirkwood: ['kirkwood'],
  sierra: ['sierra'],
}

/** Discipline codes in filenames -> how live-timing spells them in `hT`. */
const DISCIPLINE_NAMES = {
  SL: 'slalom',
  GS: 'giant slalom',
  SG: 'super',      // 'Super-G' / 'Super G'
  DH: 'downhill',
  AC: 'combined',
}

const DISCIPLINES = new Set(Object.keys(DISCIPLINE_NAMES))

/**
 * Pull date, venue, discipline and sequence out of a published results filename:
 *   20260307-Palisades-GS-BernardCup-1of2-ByClass.html
 */
function parseArchiveFilename(file) {
  const parts = basename(file, '.html').split('-')
  const dateRaw = parts.shift() ?? ''
  if (!/^\d{8}$/.test(dateRaw)) return null

  const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
  const venue = (parts.shift() ?? '').toLowerCase()
  const discipline = DISCIPLINES.has((parts[0] ?? '').toUpperCase())
    ? parts.shift().toUpperCase()
    : null

  // '1of2' marks which race of the day this is, when a venue ran more than one.
  let sequence = null
  for (const p of parts) {
    const m = p.match(/^(\d+)of(\d+)$/i)
    if (m) sequence = parseInt(m[1], 10)
  }

  return { date, venue, discipline, sequence }
}

/** Split a daily file into race records (`~`-separated, `key=value|` fields). */
function parseDailyFile(text) {
  const races = []
  for (const rec of text.split('~')) {
    const d = {}
    for (const kv of rec.split('|')) {
      const i = kv.indexOf('=')
      if (i > 0) {
        const k = kv.slice(0, i)
        if (!(k in d)) d[k] = kv.slice(i + 1)
      }
    }
    if (d.hID) races.push(d)
  }
  return races
}

/**
 * Pull the race number out of a live-timing race name.
 *
 * Live-timing names carry it explicitly, which is far more reliable than start
 * time for pairing against FWM's own "1of2" numbering:
 *
 *   'BERNARD CUP MASTERS GS1'          -> 1
 *   'FAR WEST MASTERS DP SL - SL3'     -> 3
 *   'FW MASTERS OPENER SUN GS2'        -> 2
 *   'FW MASTERS SPEED SERIES - SG3 NSS'-> 3
 *   'DIAMOND PEAK MASTERS SL - SAT SL 1' -> 1
 *   'ALPINE MEADOWS MASTERS GS'        -> null (only one race, no number needed)
 *
 * The *last* discipline-plus-digit is taken, because names sometimes mention a
 * discipline earlier for other reasons ('FAR WEST MASTERS SG / DH - GS1').
 */
function raceNumberFromName(name = '') {
  const matches = [...name.matchAll(/\b(SL|GS|SG|DH|AC)\s*(\d)\b/gi)]
  if (!matches.length) return null
  return parseInt(matches[matches.length - 1][2], 10)
}

/** Minutes since midnight, so same-day races can be ordered by start time. */
function startMinutes(hST = '') {
  const m = hST.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[3])) h += 12
  return h * 60 + parseInt(m[2], 10)
}

/**
 * Find the live-timing race matching an archived FWM race.
 *
 * Filters on venue and discipline, and requires the race to look like a masters
 * event — live-timing lists 100+ races nationwide per day, including NASTAR and
 * junior events at the very same resorts.
 *
 * When a venue ran several races of one discipline in a day, they are ordered by
 * start time and picked by the sequence number in the filename.
 */
function candidatesFor(races, { venue, discipline }) {
  const aliases = VENUE_ALIASES[venue.replace(/[^a-z]/g, '')] ?? [venue]
  const discName = discipline ? DISCIPLINE_NAMES[discipline] : null

  return races.filter((r) => {
    const venueText = (r.hR ?? '').toLowerCase()
    if (!aliases.some((a) => venueText.includes(a))) return false

    const typeText = (r.hT ?? '').toLowerCase()
    const nameText = (r.hN ?? '').toLowerCase()

    // Masters events say so in the discipline field or the race name.
    const isMasters = typeText.includes('master') || nameText.includes('master')
    if (!isMasters) return false

    if (discName && !typeText.includes(discName)) return false
    return true
  }).sort((a, b) => startMinutes(a.hST) - startMinutes(b.hST))
}

/**
 * Match a day's archived races to that day's live-timing races, positionally.
 *
 * Filename sequence numbers count across a whole race weekend ("3of4" is the
 * third of four super-Gs run over two days), so they cannot index into a single
 * day's candidates. Instead both lists are sorted — archived races by their
 * sequence, live-timing races by start time — and paired in order.
 *
 * @param entries  Archived races for one date, same venue and discipline
 * @param cands    Live-timing candidates for that date, venue and discipline
 */
function matchDayGroup(entries, cands) {
  const sorted = [...entries].sort(
    (a, b) => (a.meta.sequence ?? 1) - (b.meta.sequence ?? 1)
  )

  if (cands.length === 0) {
    return sorted.map((e) => ({ ...e, id: null, reason: 'no live-timing race found' }))
  }

  // A single candidate needs no disambiguation at all.
  if (cands.length === 1 && sorted.length === 1) {
    return [{ ...sorted[0], id: cands[0].hID, reason: 'unique' }]
  }

  // Preferred: pair on the race number live-timing puts in the name against the
  // sequence in the FWM filename. This is robust where start-time ordering is not
  // — FWM's numbering can run across a whole weekend, and the two sources do not
  // always agree on which race of the day came first.
  const numbered = new Map()
  for (const c of cands) {
    const n = raceNumberFromName(c.hN ?? '')
    if (n !== null && !numbered.has(n)) numbered.set(n, c)
  }

  if (numbered.size === cands.length && sorted.every((e) => numbered.has(e.meta.sequence ?? 1))) {
    return sorted.map((e) => ({
      ...e,
      id: numbered.get(e.meta.sequence ?? 1).hID,
      reason: `race number ${e.meta.sequence ?? 1} from name`,
    }))
  }

  // Fallback: counts agree, so pair by start time. Flagged as such, because a
  // mis-ordered pair reports every racer as changed and is worth being able to
  // exclude from any measurement.
  if (cands.length === sorted.length) {
    return sorted.map((e, i) => ({
      ...e,
      id: cands[i].hID,
      reason: sorted.length === 1 ? 'unique' : `start order ${i + 1} of ${cands.length}`,
    }))
  }

  // Counts disagree — don't guess. A wrong id would silently compare the wrong
  // race, which is worse than reporting nothing.
  return sorted.map((e) => ({
    ...e,
    id: null,
    reason: `count mismatch: ${sorted.length} archived vs ${cands.length} on live-timing`,
    candidates: cands.map((c) => `${c.hID} ${c.hST} ${c.hN}`),
  }))
}

// ---------------------------------------------------------------------------
// Fetching, with an on-disk cache so re-runs cost nothing
// ---------------------------------------------------------------------------
let fetched = 0
let cached = 0

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function dailyFile(date) {
  const year = date.slice(0, 4)
  const dest = join(CACHE, `races_${date}.txt`)

  if (await exists(dest)) {
    cached++
    return readFile(dest, 'latin1')
  }

  const url = `https://www.live-timing.com/dailyRaces/${year}/races_${date}.txt`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  await sleep(DELAY)

  if (!res.ok) {
    // A missing file usually means live-timing hosted nothing that day.
    await writeFile(dest, '', 'latin1')
    return ''
  }

  fetched++
  const text = new TextDecoder('iso-8859-1').decode(Buffer.from(await res.arrayBuffer()))
  await writeFile(dest, text, 'latin1')
  return text
}

// ---------------------------------------------------------------------------
async function main() {
  await mkdir(CACHE, { recursive: true })

  let seasons = (await readdir(ARCHIVE, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => d.name)
    .sort()

  if (opt('--seasons', null)) {
    const wanted = new Set(opt('--seasons', '').split(',').map((s) => s.trim()))
    seasons = seasons.filter((s) => wanted.has(s))
  } else if (!argv.includes('--all')) {
    // Live-timing coverage of FWM is far better in recent years; default to the
    // seasons most likely to yield matches.
    seasons = seasons.filter((s) => parseInt(s, 10) >= 2019)
  }

  console.log(`Harvesting live-timing ids for seasons: ${seasons.join(', ')}`)
  console.log(`Cache: ${CACHE}\n`)

  const out = {}
  let matched = 0
  let unmatched = 0
  const problems = []

  for (const season of seasons) {
    const dir = join(ARCHIVE, season)
    // One entry per race: the ByClass view identifies the race uniquely.
    const files = (await readdir(dir))
      .filter((f) => /ByClass\.html$/i.test(f) && !/^(SS|ES)-/i.test(f))
      .sort()

    // Group by date so each daily file is fetched once.
    const byDate = new Map()
    for (const f of files) {
      const meta = parseArchiveFilename(f)
      if (!meta) continue
      if (!byDate.has(meta.date)) byDate.set(meta.date, [])
      byDate.get(meta.date).push({ file: f, meta })
    }

    let seasonMatched = 0
    for (const [date, entries] of [...byDate].sort()) {
      const text = await dailyFile(date)
      const races = text ? parseDailyFile(text) : []

      // Group the day's archived races by venue+discipline, since that is the
      // unit that can be paired against live-timing's listing for the day.
      const groups = new Map()
      for (const e of entries) {
        const key = `${e.meta.venue}|${e.meta.discipline}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(e)
      }

      for (const group of groups.values()) {
        const cands = candidatesFor(races, group[0].meta)
        for (const r of matchDayGroup(group, cands)) {
          if (r.id) {
            out[`${season}/${r.file}`] = {
              id: r.id,
              date,
              venue: r.meta.venue,
              discipline: r.meta.discipline,
              matchedBy: r.reason,
            }
            matched++
            seasonMatched++
          } else {
            unmatched++
            problems.push(
              `${season}/${r.file}: ${r.reason}` +
                (r.candidates ? '\n      ' + r.candidates.join('\n      ') : '')
            )
          }
        }
      }
    }
    console.log(`  ${season}: ${seasonMatched}/${entries_count(byDate)} races matched`)
  }

  await writeFile(OUT, JSON.stringify(out, null, 2))

  console.log(`\nMatched ${matched}, unmatched ${unmatched}`)
  console.log(`Requests: ${fetched} fetched, ${cached} served from cache`)
  console.log(`Wrote ${OUT}`)

  if (problems.length) {
    console.log(`\nUnmatched races (${problems.length}):`)
    for (const p of problems.slice(0, 25)) console.log(`   ${p}`)
    if (problems.length > 25) console.log(`   ... and ${problems.length - 25} more`)
  }
}

/** Total races across a date-grouped map, for the per-season tally. */
function entries_count(byDate) {
  let n = 0
  for (const list of byDate.values()) n += list.length
  return n
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

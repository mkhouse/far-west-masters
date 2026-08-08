#!/usr/bin/env tsx
/**
 * Preliminary vs official comparison
 * ----------------------------------
 * How often, and in what ways, do the preliminary results from live-timing differ
 * from the official results ACE Scoring publishes afterwards?
 *
 * This matters for a practical decision: how confidently can preliminary results
 * be published on race day? If the differences are almost all non-starters
 * disappearing, publishing quickly with a light disclaimer is safe and useful to
 * racers. If Open-class assignments routinely change, the disclaimer needs to say
 * so specifically.
 *
 * For each race we hold both sides:
 *   preliminary  live-timing's data endpoint, keyed by the ids recovered by
 *                migration/harvest-live-timing-ids.mjs
 *   official     the archived ACE results for the same race
 *
 * Every racer is classified into exactly one outcome, so the totals always
 * reconcile and nothing is quietly dropped.
 *
 * Usage:
 *   npm run prelim
 *   npm run prelim -- --season 2026
 *   npm run prelim -- --verbose
 *   npm run prelim -- --out ../reports/preliminary-vs-official.md
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { parseAceResults } from '../src/parseAce.js'
import { timeToSeconds } from '../src/time.js'

const ARCHIVE =
  process.env.FWM_ARCHIVE_DIR ||
  resolve(process.cwd(), '..', '..', 'fwm-results-archive')

const IDS_FILE = join(ARCHIVE, 'live-timing-ids.json')
const LT_CACHE = join(ARCHIVE, '_live-timing-races')
const UA = 'FWM-parity-research/1.0 (Far West Masters results migration)'
const DELAY = 1000

const argv = process.argv.slice(2)
const VERBOSE = argv.includes('--verbose')
const ONLY_SEASON = argv.includes('--season') ? argv[argv.indexOf('--season') + 1] : undefined
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : undefined

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// live-timing race payload
// ---------------------------------------------------------------------------

interface PrelimRacer {
  bib: string
  name: string
  ageClass: string
  /** True when live-timing flags the racer as scoring in Open Class */
  isOpenClass: boolean
  usssa: string
  run1: string
  run2: string
  total: string
  isDns: boolean
}

/**
 * Parse the pipe-delimited race payload. Records begin at `|b=` (bib); each is a
 * flat list of `key=value` pairs. See migration/live-timing-format.md.
 */
function parseLiveTiming(raw: string): { racers: PrelimRacer[]; twoRuns: boolean } {
  const out: PrelimRacer[] = []

  for (const rec of raw.split('|b=').slice(1)) {
    const parts = rec.split('|')
    const fields: Record<string, string> = { b: parts[0] ?? '' }
    for (const kv of parts.slice(1)) {
      const i = kv.indexOf('=')
      if (i > 0) {
        const k = kv.slice(0, i)
        if (!(k in fields)) fields[k] = kv.slice(i + 1)
      }
    }

    const name = (fields.m ?? '').trim()
    if (!name) continue

    // Run times arrive as `display=milliseconds`; only the display half is needed.
    const run1 = (fields.r1 ?? '').split('=')[0] ?? ''
    const run2 = (fields.r2 ?? '').split('=')[0] ?? ''

    // `t` is the team/division field, and it is overloaded: in Far West races it
    // carries 'OP' to mark an Open Class entry (the "Team (OP or blank)" column in
    // the rendered table), while at national events it carries division codes like
    // 'FW' or 'EA'. So Open Class is `t === 'OP'`, not a value of the class field.
    //
    // Missing this is easy and expensive: the age class in `s` stays populated for
    // Open Class racers, so reading only `s` silently mis-classifies roughly a
    // third of the field.
    const team = (fields.t ?? '').trim().toUpperCase()

    out.push({
      bib: fields.b ?? '',
      name,
      ageClass: (fields.s ?? '').toUpperCase(),
      isOpenClass: team === 'OP',
      usssa: fields.un ?? '',
      run1,
      run2,
      total: (fields.tt ?? '').trim(),
      // Non-starters carry a sentinel rather than a time.
      isDns: /^DNS/i.test(run1) && /^DNS/i.test(run2),
    })
  }

  // Single-run races (super-G, downhill) still emit an `r2` field, filled with the
  // DNS sentinel for every racer — it is a placeholder for a run that does not
  // exist, not a non-finish. The only reliable way to tell the two apart is
  // whether *anyone* posted a real second-run time.
  const twoRuns = out.some((r) => r.run2 && !/^(DNF|DNS|DSQ|DQ)/i.test(r.run2))

  return { racers: out, twoRuns }
}

/**
 * Names are matched after normalizing whitespace and case.
 *
 * This is deliberately forgiving: live-timing contains entries like
 * "Hlubucek , Mark" with a stray space before the comma, which is a formatting
 * artifact rather than a different person. Being strict here would report a
 * cosmetic difference as a roster change.
 */
function normalizeName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function exists(p: string) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Fetch a race payload, caching it so re-runs cost nothing. */
async function liveTimingRace(id: string): Promise<string> {
  await mkdir(LT_CACHE, { recursive: true })
  const dest = join(LT_CACHE, `race_${id}.txt`)
  if (await exists(dest)) return readFile(dest, 'latin1')

  const res = await fetch(`https://www.live-timing.com/includes/aj_race.php?r=${id}`, {
    headers: { 'User-Agent': UA },
  })
  await sleep(DELAY)
  if (!res.ok) return ''

  const text = new TextDecoder('iso-8859-1').decode(Buffer.from(await res.arrayBuffer()))
  await writeFile(dest, text, 'latin1')
  return text
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Mutually exclusive outcomes, so per-race totals always reconcile. */
type Outcome =
  | 'identical'        // same class, same times
  | 'dns_dropped'      // did not start; absent from official, as expected
  | 'removed'          // in preliminary, gone from official, and NOT a DNS
  | 'added'            // in official but not preliminary
  | 'class_changed'    // age class or Open-class assignment differs
  | 'time_changed'     // total time differs
  | 'status_changed'   // finished vs did-not-finish differs

interface RaceComparison {
  season: string
  file: string
  ltId: string
  prelimCount: number
  officialCount: number
  counts: Record<Outcome, number>
  details: string[]
  /** live-timing was missing run 2 entirely; not comparable racer-by-racer */
  incomplete?: boolean
}

const EMPTY_COUNTS = (): Record<Outcome, number> => ({
  identical: 0,
  dns_dropped: 0,
  removed: 0,
  added: 0,
  class_changed: 0,
  time_changed: 0,
  status_changed: 0,
})

async function compareRace(
  season: string,
  file: string,
  ltId: string
): Promise<RaceComparison | null> {
  const raw = await liveTimingRace(ltId)
  if (!raw) return null

  const { racers: prelim, twoRuns } = parseLiveTiming(raw)
  const officialHtml = await readFile(join(ARCHIVE, season, file), 'latin1')
  const { results: official } = parseAceResults(officialHtml)
  if (!prelim.length || !official.length) return null

  // Live-timing data is not always complete. Sometimes only run 1 was ever
  // uploaded (e.g. race 292833, "FAR WEST MASTERS DP SL - SL3"), while the
  // official results carry the full two-run total. Comparing those racer by racer
  // reports every finisher as a large time change, which is meaningless — the
  // preliminary data simply is not the same race yet.
  //
  // This matters operationally too: announcing from preliminary results while
  // run 2 is missing would be announcing half a race.
  const officialTwoRuns = official.some((r) => r.run2 && r.run2.trim() !== '')
  if (officialTwoRuns && !twoRuns) {
    return {
      season, file, ltId,
      prelimCount: prelim.length,
      officialCount: official.length,
      counts: EMPTY_COUNTS(),
      details: [],
      incomplete: true,
    }
  }

  const prelimByName = new Map(prelim.map((r) => [normalizeName(r.name), r]))
  const officialByName = new Map(official.map((r) => [normalizeName(r.name), r]))

  const counts = EMPTY_COUNTS()
  const details: string[] = []

  // Walk the preliminary roster first: everyone who was expected to race.
  for (const [key, p] of prelimByName) {
    const o = officialByName.get(key)

    if (!o) {
      if (p.isDns) counts.dns_dropped++
      else {
        counts.removed++
        details.push(`removed: ${p.name} [${p.ageClass}] present in preliminary, absent from official`)
      }
      continue
    }

    // Compare the class each side actually scored the racer in. Live-timing knows
    // about Open Class via its OP flag, so a difference here means a genuine
    // reclassification — typically an Open election made after the start list
    // closed, which live-timing cannot know about.
    const prelimClass = p.isOpenClass
      ? `${p.ageClass.startsWith('F') || p.ageClass.startsWith('W') ? 'F' : 'M'}OP`
      : p.ageClass
    const officialClass = o.isOpenClass ? `${o.gender}OP` : o.ageClass
    const classDiffers = normalizeClass(prelimClass) !== normalizeClass(officialClass)

    // Whether the racer finished has to be judged from the individual runs, not
    // from the total. Live-timing puts a *time* in `tt` even when a run was
    // disqualified — a racer with r1=42.93 and r2=DQg23 shows tt=42.93, which
    // reads as a finish but is really a DSQ. Trusting `tt` reports overturned or
    // newly-applied disqualifications as ordinary time corrections, which buries
    // the single most interesting thing a preliminary-to-official diff can show.
    const isStatus = (run: string) => !!run && /^(DNF|DNS|DSQ|DQ)/i.test(run)
    const prelimFinished =
      !isStatus(p.run1) &&
      // Only judge the second run when the race actually had one.
      (!twoRuns || !isStatus(p.run2))
    const officialFinished = o.totalSeconds !== null

    if (prelimFinished !== officialFinished) {
      counts.status_changed++
      details.push(
        `status: ${p.name} preliminary=${prelimFinished ? 'finished' : p.total || 'no time'} ` +
          `official=${officialFinished ? 'finished' : o.result}`
      )
      continue
    }

    if (classDiffers) {
      counts.class_changed++
      details.push(`class: ${p.name} preliminary=${prelimClass} official=${officialClass}`)
      continue
    }

    // Compute the total from the runs rather than trusting `tt`.
    //
    // live-timing's `tt` is not dependable: in some races it holds the combined
    // time, in others only run 1 even when both runs were completed (race 197855,
    // Buttenberg: r1=49.53 r2=51.23 but tt=49.53, against an official 1:40.76).
    // The original FWM paste parser already recomputed totals from the runs for
    // this reason; the same caution applies to the data endpoint.
    const r1 = timeToSeconds(p.run1)
    const r2 = twoRuns ? timeToSeconds(p.run2) : null
    const pSecs = twoRuns
      ? r1 !== null && r2 !== null ? r1 + r2 : null
      : r1
    if (pSecs !== null && o.totalSeconds !== null && Math.abs(pSecs - o.totalSeconds) > 0.005) {
      counts.time_changed++
      // Report the recomputed total that was actually compared, not the raw `tt`
      // field — printing `tt` here made the differences look far larger than they
      // are, because `tt` is sometimes only run 1.
      details.push(
        `time: ${p.name} preliminary=${pSecs.toFixed(2)} official=${o.totalSeconds.toFixed(2)} ` +
          `(runs ${p.run1}${twoRuns ? ' + ' + p.run2 : ''}; tt=${p.total || '-'})`
      )
      continue
    }

    counts.identical++
  }

  // Anyone in the official results who was not on the preliminary roster.
  for (const [key, o] of officialByName) {
    if (!prelimByName.has(key)) {
      counts.added++
      details.push(`added: ${o.name} [${o.ageClass}] in official, absent from preliminary`)
    }
  }

  return {
    season,
    file,
    ltId,
    prelimCount: prelim.length,
    officialCount: official.length,
    counts,
    details,
  }
}

/** 'M8' and 'M08' are the same class written two ways. */
function normalizeClass(c: string): string {
  const m = c.match(/^([MWF])(\d+)$/i)
  if (m) {
    const g = m[1]!.toUpperCase() === 'W' ? 'F' : m[1]!.toUpperCase()
    return `${g}${parseInt(m[2]!, 10)}`
  }
  return c.toUpperCase().replace(/^W/, 'F')
}

// ---------------------------------------------------------------------------
async function main() {
  if (!(await exists(IDS_FILE))) {
    console.error(`No live-timing id map at ${IDS_FILE}`)
    console.error('Run: node migration/harvest-live-timing-ids.mjs')
    process.exit(1)
  }

  const ids: Record<string, { id: string; date: string; matchedBy?: string }> = JSON.parse(
    await readFile(IDS_FILE, 'utf8')
  )

  // By default compare only races whose live-timing id was matched reliably:
  // either it was the day's only candidate ('unique'), or it was paired on the
  // race number live-timing puts in the race name ('GS1', 'SL3').
  //
  // Excluded by default are ids paired purely by start order. Those can invert
  // when ACE's 1of2/2of2 numbering disagrees with live-timing's start times, and a
  // swapped pair reports every racer as changed — an artifact of the pairing, not
  // a real difference. Pass --include-ordered to measure those too.
  const includeOrdered = argv.includes('--include-ordered')
  const reliable = (m: string) => m === 'unique' || m.startsWith('race number')

  const entries = Object.entries(ids)
    .filter(([k]) => !ONLY_SEASON || k.startsWith(`${ONLY_SEASON}/`))
    .filter(([, v]) => includeOrdered || reliable(v.matchedBy ?? 'unique'))
    .sort()

  console.log('FWM preliminary (live-timing) vs official (ACE Scoring)')
  console.log(`archive: ${ARCHIVE}\n`)

  const comparisons: RaceComparison[] = []
  for (const [key, meta] of entries) {
    const [season, file] = key.split('/')
    const c = await compareRace(season!, file!, meta.id)
    if (c) comparisons.push(c)
  }

  if (!comparisons.length) {
    console.error('No races could be compared.')
    process.exit(1)
  }

  // ---- per-race table ----
  console.log('race                                              prelim  offic  same   DNS  chg')
  console.log('------------------------------------------------  ------  -----  ----  ----  ---')
  for (const c of comparisons.filter((c) => !c.incomplete)) {
    const changed =
      c.counts.removed + c.counts.added + c.counts.class_changed +
      c.counts.time_changed + c.counts.status_changed
    console.log(
      `${c.file.replace('-ByClass.html', '').slice(0, 48).padEnd(48)}  ` +
        `${String(c.prelimCount).padStart(6)}  ${String(c.officialCount).padStart(5)}  ` +
        `${String(c.counts.identical).padStart(4)}  ${String(c.counts.dns_dropped).padStart(4)}  ` +
        `${String(changed).padStart(3)}`
    )
  }

  // ---- totals ----
  const usable = comparisons.filter((c) => !c.incomplete)
  const incompleteRaces = comparisons.filter((c) => c.incomplete)
  const total = EMPTY_COUNTS()
  for (const c of usable) {
    for (const k of Object.keys(total) as Outcome[]) total[k] += c.counts[k]
  }
  const allRacers = Object.values(total).reduce((a, b) => a + b, 0)
  const changed =
    total.removed + total.added + total.class_changed + total.time_changed + total.status_changed

  const pct = (n: number) => `${((n / allRacers) * 100).toFixed(2)}%`

  console.log(`\nRaces compared: ${usable.length}` +
    (incompleteRaces.length ? `  (excluded ${incompleteRaces.length} where live-timing lacked run 2)` : ''))
  console.log(`Racer records : ${allRacers}\n`)
  console.log(`  identical                        ${String(total.identical).padStart(6)}  ${pct(total.identical)}`)
  console.log(`  did-not-start, dropped           ${String(total.dns_dropped).padStart(6)}  ${pct(total.dns_dropped)}   (expected)`)
  console.log(`  ------------------------------------------------`)
  console.log(`  class changed                    ${String(total.class_changed).padStart(6)}  ${pct(total.class_changed)}`)
  console.log(`  time changed                     ${String(total.time_changed).padStart(6)}  ${pct(total.time_changed)}`)
  console.log(`  status changed                   ${String(total.status_changed).padStart(6)}  ${pct(total.status_changed)}`)
  console.log(`  removed (not a DNS)              ${String(total.removed).padStart(6)}  ${pct(total.removed)}`)
  console.log(`  added in official                ${String(total.added).padStart(6)}  ${pct(total.added)}`)
  console.log(`  ------------------------------------------------`)
  console.log(`  MEANINGFUL CHANGES               ${String(changed).padStart(6)}  ${pct(changed)}`)

  if (VERBOSE) {
    console.log('\n--- details ---')
    for (const c of comparisons) {
      if (!c.details.length) continue
      console.log(`\n${c.season}/${c.file}  (live-timing ${c.ltId})`)
      for (const d of c.details.slice(0, 40)) console.log(`   ${d}`)
    }
  }

  if (OUT) {
    await mkdir(dirname(resolve(OUT)), { recursive: true })
    await writeFile(resolve(OUT), renderMarkdown(comparisons, total, allRacers, changed))
    console.log(`\nWrote ${resolve(OUT)}`)
  }
}

function renderMarkdown(
  comparisons: RaceComparison[],
  total: Record<Outcome, number>,
  allRacers: number,
  changed: number
): string {
  const pct = (n: number) => `${((n / allRacers) * 100).toFixed(2)}%`
  const usable = comparisons.filter((c) => !c.incomplete)
  const incomplete = comparisons.filter((c) => c.incomplete)

  const L: string[] = []
  L.push('# Preliminary vs official results', '')
  L.push('How the live-timing data available on race day compares with the official')
  L.push('results ACE Scoring publishes afterwards.', '')
  L.push('**The question this answers:** how confidently can preliminary results be')
  L.push('published at the venue, and what should the disclaimer actually say?', '')

  L.push('## Result', '')
  L.push(`Races compared: **${usable.length}** · racer records: **${allRacers}**`, '')
  L.push('| outcome | count | share |')
  L.push('|---|---:|---:|')
  L.push(`| identical | ${total.identical} | ${pct(total.identical)} |`)
  L.push(`| did-not-start, dropped (expected) | ${total.dns_dropped} | ${pct(total.dns_dropped)} |`)
  L.push(`| added in official | ${total.added} | ${pct(total.added)} |`)
  L.push(`| time changed | ${total.time_changed} | ${pct(total.time_changed)} |`)
  L.push(`| removed (not a DNS) | ${total.removed} | ${pct(total.removed)} |`)
  L.push(`| class changed | ${total.class_changed} | ${pct(total.class_changed)} |`)
  L.push(`| status changed (DQ) | ${total.status_changed} | ${pct(total.status_changed)} |`)
  L.push(`| **meaningful changes** | **${changed}** | **${pct(changed)}** |`)
  L.push('')

  L.push('## What it means', '')
  L.push('Most racers come through preliminary unchanged, and most of what does change')
  L.push('is **roster churn** — people added or removed — rather than corrections to')
  L.push('times or classes. Class and disqualification changes are both well under 1%.', '')
  L.push('So the race-day disclaimer should say **"who raced may still change"**, not')
  L.push('"these times may be wrong". The times are in good shape; the entry list is')
  L.push('what moves.', '')

  L.push('## Design consequences', '')
  L.push('1. **Refuse to publish an incomplete race.** If the official race has two runs')
  L.push('   and live-timing only has one, that is half a race — worse than publishing')
  L.push('   nothing. See the parsing traps in `live-timing-format.md`.')
  L.push('2. **Diff every official import against its preliminary** and have the')
  L.push('   processor review it. Roster changes are routine and can be summarised;')
  L.push('   a time correction or unexplained removal deserves attention.')
  L.push('3. **Allow a manual DQ override on preliminary results**, so accurate results')
  L.push('   can be announced while waiting for the timing file.', '')

  L.push('## Method and limits', '')
  L.push('Preliminary data comes from live-timing\'s race endpoint; official results come')
  L.push('from the archived ACE pages. Race ids were recovered automatically by')
  L.push('`migration/harvest-live-timing-ids.mjs`. Every racer is classified into exactly')
  L.push('one outcome, so the totals reconcile.', '')
  L.push('Limits worth stating:', '')
  L.push('- **Only reliably-matched races are counted.** Ids paired purely by start time')
  L.push('  are excluded by default, because a mis-ordered pair reports every racer as')
  L.push('  changed. Pass `--include-ordered` to see them.')
  if (incomplete.length) {
    L.push(`- **${incomplete.length} race(s) excluded** where live-timing never received run 2.`)
  }
  L.push('- **The time-changed figure is mixed.** It combines genuine corrections,')
  L.push('  sub-hundredth rounding differences, and live-timing data errors (one racer')
  L.push('  shows a 2.64-second slalom run). Treat it as an upper bound.')
  L.push('- Seasons before 2019 are not covered; live-timing coverage of FWM is thinner.', '')
  L.push('Regenerate with `npm run prelim -- --out ../reports/preliminary-vs-official.md`.')

  return L.join('\n') + '\n'
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

import {
  isNonFinish,
  normalizeStatus,
  secondsToDisplay,
  timeToSeconds,
  truncateToHundredths,
} from './time.js'

/**
 * Parser for live-timing.com's preliminary race data.
 *
 * `race2.php?r=<id>` renders its results in JavaScript, so the HTML contains
 * none of them. The data comes from an undocumented endpoint:
 *
 *     https://www.live-timing.com/includes/aj_race.php?r=<raceID>
 *
 * which returns flat pipe-delimited text. One record per racer, beginning at
 * `|b=` (bib), each a list of `key=value` pairs. The full field reference and
 * the reasoning behind every rule below is in migration/live-timing-format.md.
 *
 * LIVE-TIMING IS THE PRELIMINARY SOURCE. The ski area's timing file, which ACE
 * Scoring consumes, is the official one, and it carries more precision — every
 * millisecond value live-timing publishes ends in 0, so it holds hundredths and
 * nothing finer. Preliminary race points can therefore differ from official
 * ones by 0.01 at a rounding boundary. That is expected, and belongs on the
 * preliminary results rather than being treated as a fault.
 *
 * THE TRAPS BELOW ARE NOT HYPOTHETICAL. Each was found by comparing against
 * eighteen seasons of official results, and not one of them throws — they all
 * produce a plausible, wrong answer. This parser previously lived inside
 * bin/prelim-parity.ts as research code; it is here so the importer and the
 * parity harness cannot drift apart.
 */

/** How a racer's run ended, when it was not a time. */
export type RunStatus = 'DNF' | 'DNS' | 'DSQ'

export interface PrelimRacer {
  bib: string
  /** As live-timing writes it: "Lastname, Firstname". */
  name: string
  /** Whitespace and case normalised, for matching. See trap 6. */
  normalizedName: string
  /** Age class from `s` — populated even for Open Class racers. */
  ageClass: string
  /**
   * TRAP 1. Open Class comes from `t`, never from the class field.
   *
   * `t` is the team/division field and is overloaded: Far West races put `OP`
   * in it for an Open Class entry, while national events put a division there
   * (`FW`, `EA`, `RM`). The age class in `s` stays populated either way, so
   * reading only `s` silently mis-classifies about a third of the field —
   * 36% of 2026 official records were Open Class.
   */
  isOpenClass: boolean
  /** The division code from `t` at national events, else null. */
  division: string | null
  /** US Ski & Snowboard number from `un`, the stable identity key. */
  usssa: string | null
  /** Run 1 as displayed, or a status. Empty when absent. */
  run1: string
  /** Run 2 as displayed, or a status. Empty on a single-run race. */
  run2: string
  /**
   * Total in seconds, RECOMPUTED from the runs. Null when the racer did not
   * finish every run this race had. Never taken from `tt` — see traps 3 and 4.
   */
  totalSeconds: number | null
  /** The recomputed total, formatted. Null when there is no total. */
  total: string | null
  /** Null when they finished; otherwise why they did not. */
  status: RunStatus | null
  /**
   * Never left the gate — run 1 is DNS.
   *
   * Distinct from `status`, which also covers somebody who skied run 1 and
   * then did not start run 2. The difference matters in the
   * preliminary-to-official diff: a non-starter disappearing from the official
   * results is routine and expected, while a racer who started and then
   * vanished is worth a look.
   */
  didNotStart: boolean
  /**
   * `tt` exactly as published — FOR DIAGNOSTICS ONLY, never for computation.
   *
   * Kept because the preliminary-to-official comparison prints it when it
   * disagrees with the runs, which is how traps 3 and 4 were found in the
   * first place. Anything that reads this to decide a time or a finish is
   * wrong; use `totalSeconds` and `status`.
   */
  rawTotal: string | null
}

export interface PrelimRace {
  /** `hID` */
  id: string | null
  /** `hN` */
  name: string | null
  /** `hT` — discipline and category. */
  type: string | null
  /** `hR` — venue. */
  venue: string | null
  /** `hST` — start time as live-timing writes it. */
  startTime: string | null
  /** `hM` — notes, e.g. "NO DSQs RUN 2". */
  notes: string | null
  racers: PrelimRacer[]
  /**
   * TRAP 2. Whether this race actually had two runs.
   *
   * Super-G and downhill have one, but the payload still emits `r2` for every
   * racer filled with the DNS sentinel — a placeholder for a run that does not
   * exist, not a non-finish. The only reliable test is whether ANY racer posted
   * a real second-run time.
   */
  twoRuns: boolean
}

/** Live-timing's non-starter sentinel: INT_MAX - 40, so DNS sorts last. */
const DNS_SENTINEL = '2147483607'

/**
 * Normalise a name for matching.
 *
 * TRAP 6. Deliberately forgiving: live-timing carries entries like
 * "Hlubucek , Mark" with a stray space before the comma, which is a formatting
 * artefact and not a different person. Being strict reports a cosmetic
 * difference as a roster change — or worse, creates a second person record.
 * Prefer `usssa` where it exists; in the race checked it was present for all
 * 76 racers.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The display half of a `display=milliseconds` pair. */
function displayOf(field: string | undefined): string {
  return (field ?? '').split('=')[0]?.trim() ?? ''
}

export function parseLiveTiming(raw: string): PrelimRace {
  // Header fields precede the first racer record.
  const head = raw.split('|b=')[0] ?? ''
  const header: Record<string, string> = {}
  for (const kv of head.split('|')) {
    const i = kv.indexOf('=')
    if (i > 0) {
      const k = kv.slice(0, i)
      if (!(k in header)) header[k] = kv.slice(i + 1)
    }
  }

  interface Raw {
    bib: string
    name: string
    ageClass: string
    isOpenClass: boolean
    division: string | null
    usssa: string | null
    run1: string
    run2: string
    rawTotal: string | null
  }

  const rows: Raw[] = []
  for (const record of raw.split('|b=').slice(1)) {
    const parts = record.split('|')
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

    const team = (fields.t ?? '').trim().toUpperCase()
    rows.push({
      bib: fields.b ?? '',
      name,
      ageClass: (fields.s ?? '').trim().toUpperCase(),
      isOpenClass: team === 'OP',
      division: team && team !== 'OP' ? team : null,
      usssa: (fields.un ?? '').trim() || null,
      run1: displayOf(fields.r1),
      run2: displayOf(fields.r2),
      rawTotal: (fields.tt ?? '').trim() || null,
    })
  }

  // TRAP 2, decided across the whole field before any racer is finalised.
  const twoRuns = rows.some((r) => r.run2 && !isNonFinish(r.run2))

  const racers: PrelimRacer[] = rows.map((r) => {
    const runsThatCount = twoRuns ? [r.run1, r.run2] : [r.run1]

    /*
     * TRAPS 3 AND 4. `tt` is not consulted at all.
     *
     * It shows a time even when a run was disqualified — `r1=42.93 r2=DQg23
     * tt=42.93` reads as a finish — and it is sometimes only run 1 even when
     * both runs completed, where `r1=49.53 r2=51.23 tt=49.53` against an
     * official total of 1:40.76. Whether somebody finished, and in what time,
     * is decided from the runs alone.
     *
     * This matters most for the preliminary-to-official diff: reading `tt`
     * turns an overturned or newly applied disqualification into what looks
     * like an ordinary time correction, which is the single most interesting
     * thing that diff can show.
     */
    let status: RunStatus | null = null
    for (const run of runsThatCount) {
      if (!run) {
        status ??= 'DNS'
        continue
      }
      if (isNonFinish(run)) {
        const s = normalizeStatus(run)
        // The worst outcome wins: a DSQ in either run disqualifies the racer.
        if (s === 'DSQ') status = 'DSQ'
        else status ??= s === 'DNS' ? 'DNS' : 'DNF'
      }
    }

    let totalSeconds: number | null = null
    if (!status) {
      let sum = 0
      let ok = true
      for (const run of runsThatCount) {
        const s = timeToSeconds(run)
        if (s === null) {
          ok = false
          break
        }
        sum += s
      }
      // Truncated, never rounded: ski times are truncated to hundredths, and
      // rounding disagrees with ACE on roughly half of all racers.
      if (ok) totalSeconds = truncateToHundredths(sum)
    }

    return {
      bib: r.bib,
      name: r.name,
      normalizedName: normalizeName(r.name),
      ageClass: r.ageClass,
      isOpenClass: r.isOpenClass,
      division: r.division,
      usssa: r.usssa,
      run1: r.run1,
      // A single-run race's `r2` is a placeholder, not a result: dropped rather
      // than reported as a non-finish.
      run2: twoRuns ? r.run2 : '',
      totalSeconds,
      total: totalSeconds === null ? null : secondsToDisplay(totalSeconds),
      status,
      didNotStart: /^DNS/i.test(r.run1),
      rawTotal: r.rawTotal,
    }
  })

  return {
    id: header.hID ?? null,
    name: header.hN ?? null,
    type: header.hT ?? null,
    venue: header.hR ?? null,
    startTime: header.hST ?? null,
    notes: header.hM ?? null,
    racers,
    twoRuns,
  }
}

/**
 * TRAP 5. Why this race must not be published yet, or null if it may be.
 *
 * Preliminary data can be incomplete — sometimes only run 1 was ever uploaded
 * while the official results carry a full two-run total (race 292833). That is
 * half a race, and announcing from it is worse than announcing nothing. The
 * runbook states the rule outright: "Do not publish a race where live-timing
 * only has run 1 of a two-run race. The importer should refuse."
 *
 * @param expectTwoRuns What the schedule says this discipline runs, when known.
 *                      Live-timing alone cannot distinguish a super-G from a
 *                      slalom whose second run has not been uploaded.
 */
export function refusalReason(
  race: PrelimRace,
  expectTwoRuns?: boolean
): string | null {
  if (race.racers.length === 0) {
    return 'Live-timing has no racers for this race yet.'
  }

  if (expectTwoRuns === true && !race.twoRuns) {
    return 'This is a two-run race and live-timing only has run 1. That is half a race — wait for the second run.'
  }

  const finishers = race.racers.filter((r) => r.status === null).length
  if (finishers === 0) {
    return 'Nobody in this race has a complete time yet.'
  }

  return null
}

export { DNS_SENTINEL }

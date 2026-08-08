/**
 * Season standings: best-N totals and class ranking with tie notation.
 *
 * Ported from `airtable-results/overall-standings.js`, which ranked racers within
 * a class by total points and marked ties by appending "(t)" to the shared rank.
 */

/** One race's contribution to a racer's season. */
export interface SeasonEntry {
  /** Position of the race in the season schedule */
  raceIndex: number
  /** Class points earned; null if the racer didn't score (non-finish or no start) */
  points: number | null
  /** True if the racer started this race — starts and finishes are counted separately */
  started: boolean
  /** True if the racer finished this race */
  finished: boolean
}

/** A racer's season, before ranking. */
export interface SeasonRacer {
  name: string
  /** Scoring class: age class code, or the Open class the racer elected */
  scoringClass: string
  entries: SeasonEntry[]
}

/** A racer's season after best-N selection and ranking. */
export interface RankedStanding {
  name: string
  scoringClass: string
  totalPoints: number
  starts: number
  finishes: number
  /** Published-style rank: '1', '2', '3(t)' when tied */
  classRank: string
  /** Race indexes whose points were counted toward the total */
  countedRaces: number[]
}

/**
 * Seasons whose best-N was not the standard formula, with the value actually used.
 *
 * 2021 was cut to six races by covid restrictions and every race counted, rather
 * than the five the formula gives. This is a club decision, not a derivable rule,
 * so it is recorded rather than computed.
 *
 * In the application these live in `seasons.best_n` and are editable; this map
 * exists so the parity harness can reproduce historical seasons without a database.
 */
export const BEST_N_OVERRIDES: Readonly<Record<number, number>> = {
  2021: 6, // covid-shortened season: all six races counted
}

/**
 * How many races count toward the season total.
 *
 * FWM counts a racer's best 75% of races, rounded up — published as "best 12
 * finishes of 16 races" for a full season.
 *
 * Verified against every published season from 2009 to 2026: `ceil(0.75 x races)`
 * reproduces every racer's published total exactly, with 2021 the sole exception
 * (see BEST_N_OVERRIDES).
 *
 * `races` is the number of races actually scored, not the number scheduled — a
 * cancelled race lowers the requirement, which is why 2026 counts best 11 of 14
 * despite the season being announced as best 12 of 16.
 *
 * @param races   Races scored in the season
 * @param season  Season ending year, used only to apply a recorded override
 */
export function bestNForSeason(races: number, season?: number): number {
  if (season !== undefined && season in BEST_N_OVERRIDES) {
    return BEST_N_OVERRIDES[season]!
  }
  return Math.ceil(races * 0.75)
}

/**
 * Sum a racer's best N scores.
 *
 * Returns both the total and which races contributed, because the published
 * standings distinguish counted from uncounted races visually.
 */
export function bestNTotal(
  entries: SeasonEntry[],
  n: number
): { total: number; countedRaces: number[] } {
  // Only scoring races can count. Sort by points descending and take the top N.
  const scoring = entries
    .filter((e) => e.points !== null && e.points > 0)
    .sort((a, b) => b.points! - a.points!)

  const counted = scoring.slice(0, n)
  return {
    total: counted.reduce((sum, e) => sum + e.points!, 0),
    countedRaces: counted.map((e) => e.raceIndex).sort((a, b) => a - b),
  }
}

/**
 * Rank racers within each class and mark ties.
 *
 * Ranking is by total points descending. Racers on equal points share a rank, and
 * every racer involved in a tie has "(t)" appended — matching how the published
 * standings render it (e.g. two racers tied for 3rd both show "3(t)").
 *
 * A shared rank consumes the positions beneath it: two racers tied at 3 are
 * followed by 5th, not 4th.
 */
export function rankStandings(
  racers: SeasonRacer[],
  racesInSeason: number,
  season?: number
): RankedStanding[] {
  const n = bestNForSeason(racesInSeason, season)

  // Compute each racer's total first; ranking depends only on the totals.
  const withTotals = racers.map((r) => {
    const { total, countedRaces } = bestNTotal(r.entries, n)
    return {
      name: r.name,
      scoringClass: r.scoringClass,
      totalPoints: total,
      starts: r.entries.filter((e) => e.started).length,
      finishes: r.entries.filter((e) => e.finished).length,
      countedRaces,
    }
  })

  // Group by scoring class — racers are only ever ranked against their own class.
  const byClass = new Map<string, typeof withTotals>()
  for (const r of withTotals) {
    const list = byClass.get(r.scoringClass)
    if (list) list.push(r)
    else byClass.set(r.scoringClass, [r])
  }

  const out: RankedStanding[] = []

  for (const group of byClass.values()) {
    group.sort((a, b) => b.totalPoints - a.totalPoints)

    // Walk runs of equal totals, assigning a shared rank to each run.
    let i = 0
    while (i < group.length) {
      const total = group[i]!.totalPoints
      let j = i
      while (j < group.length && group[j]!.totalPoints === total) j++

      const rank = i + 1 // 1-based; ties below consume the skipped positions
      const isTie = j - i > 1

      for (let k = i; k < j; k++) {
        out.push({ ...group[k]!, classRank: isTie ? `${rank}(t)` : String(rank) })
      }
      i = j
    }
  }

  return out
}

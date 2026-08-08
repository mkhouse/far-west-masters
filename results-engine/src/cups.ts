/**
 * Cup results — age-handicapped combined scoring.
 *
 * Ported from `airtable-results/cup-results-calc.js`.
 *
 * The Bernard Cup handicap system was created so racers of any age can compete
 * against each other on one list: each racer's time is reduced by a percentage
 * that grows with their age class, then the adjusted times for the two paired
 * races are added together.
 *
 *     BCTime = Time x (1 - HANDICAP x (ageClassNumber - 1))
 *
 * Class 1 (the youngest) races at full time; every class above it gets a larger
 * reduction. See migration/cup-rules.md for the published tables.
 *
 * IMPORTANT: not every cup uses this. The McKinney Cup / Silver Dollar Derby is
 * decided on raw combined time with no handicap at all, and Viva Italia before
 * 1997 had no formula whatsoever. Check `CupScoring` before applying this.
 */

import { secondsToDisplay, truncateToHundredths } from './time.js'
import type { Discipline, Gender } from './types.js'

/** How a given cup is decided. See migration/cup-rules.md. */
export type CupScoring =
  | 'age_handicap' // Bernard Cup; Viva Italia from 1997
  | 'raw_combined' // McKinney Cup / Silver Dollar Derby — fastest total time
  | 'historical_only' // Viva Italia pre-1997 ("Gianotti Criteria") — never computed

/**
 * Handicap rate per five-year age class.
 *
 * The documented rates are 3% for slalom and 2.5% for GS / combined events.
 *
 * BUT the rate is a property of the cup as run that season, **not** something to
 * derive from the disciplines of the paired races. Verified against every
 * published cup 2010-2026 by solving each racer's handicapped time back to a rate:
 *
 *   - Viva Italia is 3.0% in every season (it is always a slalom trophy)
 *   - Bernard Cup is 2.5% in almost every season — including seasons where both
 *     paired races were slalom (2015) and seasons mixing GS and SL (2011, 2013,
 *     2014, 2016, 2017, 2022)
 *   - Bernard Cup used 3.0% in 2018 and 2020 only
 *
 * Since 2015 and 2018 were both all-slalom Bernard Cups scored at different rates,
 * this is a per-event decision rather than a rule. Treat it as configuration:
 * `cups.handicap_rate` in the database, set when the cup is created.
 */
export const HANDICAP_SL = 0.03
export const HANDICAP_GS = 0.025

/** Documented default for a cup, by the kind of trophy it is. */
export const DEFAULT_CUP_HANDICAP = HANDICAP_GS

/**
 * Age class number -> time multiplier.
 * Class 1 returns 1.0 (no adjustment); each class above reduces the time further.
 *
 * @param rate  Handicap per class for this cup (see above) — configuration, not
 *              something to infer from the race disciplines
 */
export function handicapMultiplier(ageClassNumber: number, rate: number): number {
  return 1 - rate * (ageClassNumber - 1)
}

/** One racer's entry in one of the cup's paired races. */
export interface CupRaceEntry {
  discipline: Discipline
  /** Total time in seconds; null if the racer did not finish or did not start */
  totalSeconds: number | null
  /** Class rank in that race, for display alongside the time */
  classRank: number | null
}

export interface CupRacer {
  name: string
  gender: Gender
  /** Age class number 1-14, which drives the handicap */
  ageClassNumber: number
  /** One entry per paired race, in schedule order */
  races: CupRaceEntry[]
}

export interface CupResult extends CupRacer {
  /** Handicapped time per race, in the same order as `races` */
  handicapped: (number | null)[]
  /** Sum of handicapped times; null unless every race was finished */
  combinedHandicap: number | null
  combinedHandicapDisplay: string | null
  /** Sum of actual times; null unless every race was finished */
  combinedRaw: number | null
  combinedRawDisplay: string | null
  starts: number
  finishes: number
  /** Finishing position within gender, or '-' when incomplete */
  position: string
  /** Numeric sort key; 999 keeps incomplete racers at the bottom */
  sortPosition: number
}

/**
 * Score a cup.
 *
 * A racer must finish *every* paired race to place: the cup rewards consistency
 * across the weekend, so a DNF in either race means no combined time and a '-'
 * for position. Those racers are still listed, at the bottom.
 *
 * Results are ordered women first, then men, and by combined time within each —
 * matching how the results are published and announced.
 *
 * @param racers   Every racer with an entry in at least one paired race
 * @param scoring  Which method this cup uses; 'raw_combined' skips the handicap
 */
export function calculateCup(
  racers: CupRacer[],
  scoring: Exclude<CupScoring, 'historical_only'> = 'age_handicap',
  handicapRate: number = DEFAULT_CUP_HANDICAP
): CupResult[] {
  const scored: CupResult[] = racers.map((r) => {
    const starts = r.races.filter((x) => x.totalSeconds !== null).length
    const finishes = starts // a recorded time is a finish; non-finishes carry null

    // Only a racer with a time in every paired race can be placed.
    const complete = r.races.length > 0 && r.races.every((x) => x.totalSeconds !== null)

    // Age class 0 sits below the youngest masters class (class 1 is 18-29) — in
    // practice a junior racing as a guest rather than a masters competitor. The
    // handicap scale starts at class 1, so there is nothing to apply: ACE marks
    // these with a 999:00.00 sentinel and places them last regardless of speed.
    // Barnhart, Lindsay (W00) won both runs of the 2015 Bernard Cup and was still
    // published 8th of 8. We reproduce that: a numbered position, sorted behind
    // everyone who could be handicapped.
    //
    // Note this is NOT the same as a missing age class on a real masters racer —
    // that should surface as a data problem to fix, not be silently placed last.
    const handicappable = r.ageClassNumber >= 1

    if (!complete) {
      return {
        ...r,
        handicapped: r.races.map(() => null),
        combinedHandicap: null,
        combinedHandicapDisplay: null,
        combinedRaw: null,
        combinedRawDisplay: null,
        starts,
        finishes,
        position: '-',
        sortPosition: 999,
      }
    }

    // One rate applies across all of the cup's races — see the note on
    // handicapMultiplier: the rate belongs to the cup, not to each discipline.
    const handicapped = r.races.map((x) =>
      scoring === 'raw_combined' || !handicappable
        ? x.totalSeconds! // raw cup ignores age; unclassed racers can't be adjusted
        : x.totalSeconds! * handicapMultiplier(r.ageClassNumber, handicapRate)
    )

    // Without a valid age class there is no comparable handicapped time, so the
    // racer sorts last rather than competing on their raw time.
    const combinedHandicap = handicappable
      ? handicapped.reduce((a, b) => a + b, 0)
      : Number.POSITIVE_INFINITY
    const combinedRaw = r.races.reduce((a, x) => a + x.totalSeconds!, 0)

    return {
      ...r,
      handicapped,
      combinedHandicap,
      combinedHandicapDisplay: secondsToDisplay(combinedHandicap),
      combinedRaw,
      combinedRawDisplay: secondsToDisplay(combinedRaw),
      starts,
      finishes,
      position: '', // assigned below, once the field is sorted
      sortPosition: 0,
    }
  })

  // Women first, then men; fastest combined time first within each. Incomplete
  // racers sort last via their Infinity-equivalent combined time.
  const genderOrder: Record<Gender, number> = { F: 1, M: 2 }
  scored.sort((a, b) => {
    if (a.gender !== b.gender) return genderOrder[a.gender] - genderOrder[b.gender]
    const at = a.combinedHandicap ?? Infinity
    const bt = b.combinedHandicap ?? Infinity
    return at - bt
  })

  // Number the placed racers, restarting for each gender.
  //
  // Racers with the same handicapped time to the published hundredth share a
  // position, marked "(t)" — the same convention the season standings use. A
  // shared position consumes the places beneath it, so two racers tied at 9 are
  // followed by 11th.
  //
  // Ties are decided on the *truncated* time, because that is the precision the
  // result is published and awarded at: two racers shown as 3:02.00 are tied,
  // even if their unrounded times differ in the fourth decimal.
  const placed = scored.filter((r) => r.sortPosition !== 999)

  for (const gender of ['F', 'M'] as Gender[]) {
    const group = placed.filter((r) => r.gender === gender)

    let i = 0
    while (i < group.length) {
      const time = truncateToHundredths(group[i]!.combinedHandicap!)

      // Find the run of racers sharing this time.
      let j = i
      while (
        j < group.length &&
        truncateToHundredths(group[j]!.combinedHandicap!) === time
      ) {
        j++
      }

      const place = i + 1 // 1-based within this gender
      const isTie = j - i > 1

      for (let k = i; k < j; k++) {
        group[k]!.position = isTie ? `${place}(t)` : String(place)
        group[k]!.sortPosition = place
      }
      i = j
    }
  }

  return scored
}

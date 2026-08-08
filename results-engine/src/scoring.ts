/**
 * Race scoring: class rank, race points, and class points.
 *
 * This is the trusted logic ported from `airtable-results/FWM-scoring-and-rank.js`,
 * verified against ACE Scoring's own published results for every FWM season from
 * 2009 onward (`npm run parity`).
 */

import type { RaceResult, ScoredResult } from './types.js'

/**
 * Score one race.
 *
 * Race points follow the US Ski & Snowboard formula:
 *
 *     points = F x (Tx / To) - F
 *
 * where F is the discipline factor for that season, Tx is the racer's total time
 * and To is the winning time *in that racer's scoring class*. The class winner
 * therefore always scores exactly 0.00, and points grow as a racer falls further
 * behind — lower is better.
 *
 * Scoring classes are age classes, except that Open class racers are scored only
 * against each other (they elect out of their age class entirely, and must not
 * appear in age class results at all).
 *
 * @param results      Every competitor in the race, finishers and not
 * @param factor       Discipline factor F for the season — see factorsForSeason()
 * @param pointsScale  Class points by position — see pointsScaleForSeason()
 */
export function calculateScoring(
  results: RaceResult[],
  factor: number,
  pointsScale: number[]
): ScoredResult[] {
  // Group finishers into their scoring class. Non-finishers (DNF/DNS/DSQ) have no
  // total time, earn nothing, and must not displace anyone in the rankings.
  const groups = new Map<string, number[]>() // scoring class -> indexes into `results`

  results.forEach((r, i) => {
    if (r.totalSeconds === null) return // non-finisher: not scored
    // Open racers are ranked against all ages of their own gender; everyone else
    // against their age class.
    const scoringClass = r.isOpenClass ? `OPEN:${r.gender}` : `AGE:${r.ageClass}`
    const existing = groups.get(scoringClass)
    if (existing) existing.push(i)
    else groups.set(scoringClass, [i])
  })

  // Index into `results` -> the scoring we computed for that racer.
  //
  // Keyed by array index rather than bib on purpose. The Airtable-era code keyed
  // its map by bib, which collapses every racer onto a single key whenever the
  // source has no bib numbers (published ACE results don't) — each racer then
  // silently inherits whichever score happened to be written last.
  const scoring = new Map<
    number,
    { classRank: number; racePoints: number; classPoints: number }
  >()

  for (const indexes of groups.values()) {
    // Fastest first. This ordering defines both rank and the winning time.
    indexes.sort((a, b) => results[a]!.totalSeconds! - results[b]!.totalSeconds!)

    const winningTime = results[indexes[0]!]!.totalSeconds!

    indexes.forEach((idx, place) => {
      const time = results[idx]!.totalSeconds!
      scoring.set(idx, {
        classRank: place + 1, // 1-based finishing position within the class
        racePoints: round2((factor * time) / winningTime - factor),
        // Positions past the end of the scale earn nothing.
        classPoints: pointsScale[place] ?? 0,
      })
    })
  }

  // Reattach scoring to every result, preserving the original order. Non-finishers
  // keep nulls rather than zeros, so "did not score" stays distinct from "scored 0".
  return results.map((r, i) => {
    const s = scoring.get(i)
    return {
      ...r,
      classRank: s?.classRank ?? null,
      racePoints: s?.racePoints ?? null,
      classPoints: s?.classPoints ?? null,
    }
  })
}

/**
 * Round to 2 decimal places, the precision race points are published at.
 *
 * The epsilon nudge keeps values that are mathematically exact at a half-cent
 * (x.xx5) from rounding down due to binary floating-point representation.
 */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

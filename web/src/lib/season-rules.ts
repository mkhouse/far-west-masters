/**
 * The club's published scoring rule, as arithmetic.
 *
 * "For 2026-2027, the season standings are based on your best results in 75% of
 * the races (rounded up)" — resources.farwestmasters.org/faq/2027/
 * Season-Scoring-and-Open-Class.pdf, which then states the answer outright:
 * "best 13 finishes of 17 races are counted".
 *
 * Pure, and in its own file, because the number it produces decides every
 * season standing and is the one figure on the setup screen nobody can check by
 * eye.
 */

/** The published fraction. Unchanged across every season on record. */
export const SCORING_FRACTION = 0.75

/**
 * Best-N from the number of races that count toward standings.
 *
 * COUNTING RACES, NOT RACES. The 2026-2027 schedule holds 21, of which four are
 * the FIS Masters World Cup Finals at Big Sky — not Far West division races, and
 * flagged `counts_toward_standings = false` by the schedule import. Taking the
 * row count would give 16 rather than 13 and produce standings that look right
 * all season and are not.
 *
 * Checks out against the last verified season: ceil(0.75 x 14) = 11.
 */
export function bestNFor(countingRaces: number): number {
  if (countingRaces <= 0) return 0
  return Math.ceil(SCORING_FRACTION * countingRaces)
}

/**
 * Whether a stored best-N still matches the schedule.
 *
 * The rules say races may be "rescheduled from the originally published
 * schedule or added to the schedule during the season in response to changing
 * conditions or special opportunities" — so the count this was set from can move
 * after it is set, and nothing would otherwise notice. A best-13 left in place
 * over 18 counting races is wrong quietly.
 */
export function bestNDrifted(storedBestN: number, countingRaces: number): boolean {
  if (storedBestN <= 0 || countingRaces <= 0) return false
  return storedBestN !== bestNFor(countingRaces)
}

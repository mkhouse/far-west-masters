/**
 * Shared types and scoring constants for the FWM results engine.
 *
 * Everything in here is a *rule*, not a mechanism — the numbers below are the
 * governing scoring rules of the sport and the club, and they change over time.
 * Where they changed, the historical values are kept so archived seasons can be
 * reproduced exactly rather than reinterpreted under today's rules.
 */

/** Competition gender categories. Ski racing scores M and F separately. */
export type Gender = 'M' | 'F'

/** Alpine disciplines: slalom, giant slalom, super-G, downhill, alpine combined. */
export type Discipline = 'SL' | 'GS' | 'SG' | 'DH' | 'AC'

/**
 * How age classes were expressed in a given season.
 *
 * FWM moved from ten-year age groups ("Men 40") to five-year classes
 * ("Men Class 4 (40-44)") for the 2010 season. The two schemes use
 * confusingly similar codes — legacy `M40` means "man in his 40s", modern
 * `M04` means "class 4, ages 40-44".
 */
export type AgeGroupScheme = 'five_year' | 'ten_year'

/**
 * US Ski & Snowboard discipline factors, used in the race-points formula.
 *
 * These are set by US Ski & Snowboard and revised every few seasons. The values
 * below were derived empirically from FWM's own published results by solving the
 * race-points formula backwards for F (see migration/scoring-history.md), which
 * is why they can be trusted for historical seasons even though we don't hold the
 * original rule books.
 *
 * Keys are the FIRST season each set applied to; a season uses the newest entry
 * at or before it. Seasons are identified by their ending year, so 2026 is the
 * 2025-26 season.
 */
export const DISCIPLINE_FACTOR_ERAS: ReadonlyArray<{
  fromSeason: number
  factors: Record<Discipline, number>
}> = [
  // Earliest era we have published results for (2008-09 season onward).
  { fromSeason: 2009, factors: { SL: 600, GS: 880, SG: 1060, DH: 1320, AC: 1360 } },
  { fromSeason: 2011, factors: { SL: 610, GS: 870, SG: 1060, DH: 1320, AC: 1360 } },
  { fromSeason: 2013, factors: { SL: 620, GS: 890, SG: 1050, DH: 1320, AC: 1360 } },
  { fromSeason: 2015, factors: { SL: 720, GS: 980, SG: 1080, DH: 1250, AC: 1360 } },
  // Current values, in force since the 2018-19 season.
  { fromSeason: 2019, factors: { SL: 730, GS: 1010, SG: 1190, DH: 1250, AC: 1360 } },
]

/** Discipline factors currently in force. Use for any new race. */
export const DISCIPLINE_FACTORS: Record<Discipline, number> =
  DISCIPLINE_FACTOR_ERAS[DISCIPLINE_FACTOR_ERAS.length - 1]!.factors

/**
 * The discipline factors that applied in a given season.
 *
 * @param season  Season identified by its ending year (2026 = the 2025-26 season)
 */
export function factorsForSeason(season: number): Record<Discipline, number> {
  // Walk newest-first and take the first era that started at or before this season.
  for (let i = DISCIPLINE_FACTOR_ERAS.length - 1; i >= 0; i--) {
    const era = DISCIPLINE_FACTOR_ERAS[i]!
    if (season >= era.fromSeason) return era.factors
  }
  // Older than anything we have on record: fall back to the earliest known set.
  return DISCIPLINE_FACTOR_ERAS[0]!.factors
}

/**
 * FWM class points by finishing position within a class ("World Cup" scale).
 *
 * Awarded to the top 30; anyone deeper scores 0. In force from the **2016** season
 * onward — measured from the published standings by migration/detect-points-scale.mjs.
 */
export const WC_POINTS_SCALE = [
  100, 80, 60, 50, 45, 40, 36, 32, 29, 26,
  24, 22, 20, 18, 16, 15, 14, 13, 12, 11,
  10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
]

/**
 * The older class-points scale, used through the 2015 season.
 * Only the top 15 scored, and the spread was far flatter than the WC scale —
 * a 20th place was worth 0 points then and 11 points now, so season standings
 * from the two eras are not comparable and must never be recomputed across them.
 */
export const LEGACY_POINTS_SCALE = [
  25, 20, 15, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
]

/**
 * Class points for a season, by finishing position.
 *
 * The changeover season (2016) was measured, not assumed: detect-points-scale.mjs
 * reads the `points (rank)` pairs out of each season's published standings and
 * reports where the scale changes. 2015 awarded 25 for a win; 2016 awarded 100.
 */
export function pointsScaleForSeason(season: number): number[] {
  return season >= 2016 ? WC_POINTS_SCALE : LEGACY_POINTS_SCALE
}

/** One competitor's result in one race, as read from a published results file. */
export interface RaceResult {
  /** Place within the class as published; null for non-finishers (shown as '-') */
  publishedPosition: number | null
  /** Competitor name, 'Lastname, Firstname' */
  name: string
  gender: Gender
  /** Canonical class code: modern 'M13'/'FOP', or legacy 'M80+' */
  ageClass: string
  /** The section header verbatim, e.g. 'Men Class 13 (85-89)' — kept for reports */
  classLabel: string
  /**
   * Open class racers choose to be scored against all ages rather than their own
   * age class, and are excluded from age-class scoring entirely.
   */
  isOpenClass: boolean

  /** Run times as strings; null when the race/format has no such run */
  run1: string | null
  run2: string | null
  /** Total as published ('1:58.95') or a status ('DNF' | 'DNS' | 'DSQ') */
  result: string
  /** Total in seconds; null for any non-finish */
  totalSeconds: number | null

  /** Race points exactly as published; null when not a finisher. Our check value. */
  publishedRacePoints: number | null
}

/** A RaceResult with our independently computed scoring attached. */
export interface ScoredResult extends RaceResult {
  /** Rank we computed within the scoring class (finishers only) */
  classRank: number | null
  /** Race points we computed: F x (Tx / To) - F */
  racePoints: number | null
  /** Class points we computed from the season's points scale */
  classPoints: number | null
}

/** Everything one published results file yielded. */
export interface ParsedRace {
  results: RaceResult[]
  ageGroupScheme: AgeGroupScheme
  /** Section headers we did not recognize — surfaced so they never fail silently */
  unparsedSections: string[]
}

/**
 * Which membership year it is, and whether the season is running.
 *
 * Pure calendar arithmetic, deliberately not marked `server-only` — see lib/format.ts
 * for the same reasoning. Nothing here reads a key, a request or the database.
 *
 * Two separate dates, and conflating them would be a real bug:
 *
 *   * **Membership year** turns over on 1 September. Membership is annual and must
 *     be renewed, so from that date nobody is a member until they join again.
 *   * **Season** — when racing and renewals actually happen — runs from about 15
 *     October to 1 April. That is the window the staleness warning applies in,
 *     because before renewals open there is genuinely nothing to import.
 *
 * NOTHING RESETS ANYONE ON 1 SEPTEMBER. Membership is a row keyed by season, not a
 * flag on a person, so on that date nobody holds a row for the new season and
 * everybody is correctly not-a-member without any job running. These functions only
 * decide which label to ask about.
 */

/** "MM-DD" as a comparable number, so 10-15 sorts after 09-01. */
function monthDay(value: string): number {
  const [m, d] = value.split('-').map(Number)
  return (m ?? 0) * 100 + (d ?? 0)
}

function monthDayOf(date: Date): number {
  return (date.getMonth() + 1) * 100 + date.getDate()
}

/**
 * The membership year containing `date`, as the club writes it: "2025-2026".
 *
 * @param yearStart "MM-DD" — when membership lapses and the label rolls over.
 */
export function seasonFor(date: Date, yearStart = '09-01'): string {
  const year = date.getFullYear()
  // On or after the turnover, the label belongs to the year just started; before it,
  // we are still in the year that began last autumn.
  const started = monthDayOf(date) >= monthDay(yearStart)
  return started ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

/**
 * Is the season running on `date`?
 *
 * The window crosses the new year — 15 October to 1 April — so it cannot be a simple
 * "between start and end" comparison. Written as a wrap-around explicitly rather than
 * left as a subtlety for whoever changes the dates later.
 */
export function isInSeason(date: Date, start = '10-15', end = '04-01'): boolean {
  const now = monthDayOf(date)
  const from = monthDay(start)
  const to = monthDay(end)

  // A window that does not wrap, should anyone ever configure one.
  if (from <= to) return now >= from && now <= to

  return now >= from || now <= to
}

/**
 * How many whole days ago something happened, for the staleness warning.
 *
 * Truncated rather than rounded: "13 days ago" should not become 14 and trip a
 * fourteen-day threshold early.
 */
export function daysSince(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000)
}

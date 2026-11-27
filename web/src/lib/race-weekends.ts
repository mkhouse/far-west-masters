/**
 * The race weekend the club is currently pointed at, for the one-tap message.
 *
 * THIS IS THE MOST IMPORTANT THING THE APP DOES. Melissa, 2026-11-27: "if
 * someone is on the slopes and it's snowing and needs to message a delay or
 * change it needs to be super easy to do." Everything here exists to get from
 * opening the app to a composed message in one tap, and to be usable by an
 * officer who never touches any other screen.
 *
 * Pure. The database work is in the page; this decides which races belong
 * together, when to show them, and what the audience of a selection is.
 */

/** A race, as this module needs it. */
export interface WeekendRace {
  id: string
  name: string
  /** 'YYYY-MM-DD'. A date column — no time, no zone. */
  date: string
  discipline: string
  venue: string | null
  /**
   * The people this race could actually text: entered, and past the consent
   * gate. Ids rather than a count so that selecting several races can union
   * them — somebody racing Saturday and Sunday is one person and one text, and
   * adding the counts would say otherwise.
   */
  eligiblePersonIds: string[]
  /**
   * Everyone entered, whether reachable or not.
   *
   * Ids, not a count, for the same reason as the field above: the entrant
   * total across a weekend is a union too. Mammoth has 45 entrants on the
   * Saturday and 41 on the Sunday and is 45 people; adding them says 86.
   */
  entrantPersonIds: string[]
}

export interface RaceDay {
  /** 'YYYY-MM-DD' */
  date: string
  races: WeekendRace[]
}

export interface RaceWeekend {
  days: RaceDay[]
  firstDate: string
  lastDate: string
  /** Every venue involved, in the order the races run. */
  venues: string[]
}

/**
 * Today, in the mountains rather than in UTC.
 *
 * NOT `new Date().toISOString().slice(0, 10)`. The server runs in UTC, so from
 * about 4pm Pacific that string is already tomorrow — and this block would stop
 * offering Saturday's race in the middle of Saturday afternoon, which is
 * precisely when a course change goes out. `lib/races.ts` carries a note about
 * the same timezone fault breaking the date formatter; this is that bug in its
 * other form.
 */
export function pacificDate(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * A `?preview=` date, or nothing.
 *
 * Validated rather than trusted. Every date comparison in this module is a
 * STRING comparison, so a half-formed value would not throw — '2026-1-5' sorts
 * before '2026-02-01' and would quietly select the wrong weekend. A value that
 * is not exactly a real YYYY-MM-DD is ignored, and the caller falls back to the
 * real day.
 */
export function validPreviewDate(raw: string | undefined | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [y, m, d] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  // Catches 2026-02-31 and 2026-13-01, which match the pattern and then roll
  // over into the following month.
  return date.toISOString().slice(0, 10) === raw ? raw : null
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** 0 = Monday. Computed from the string, never from a local Date. */
function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/** The Monday of the week this date falls in. */
export function mondayOf(iso: string): string {
  return addDays(iso, -weekdayIndex(iso))
}

/**
 * Group races into weekends by contiguous dates, IGNORING VENUE.
 *
 * Melissa, 2026-11-27: "a weekend with three races at Palisades and Alpine need
 * to both show up." The 5–7 March weekend really is two Alpine races on the
 * Friday and Bernard Cup at Palisades Tahoe on the Saturday and Sunday, and
 * grouping by venue would split it into two things an officer thinks of as one.
 *
 * A gap of one day still counts as the same weekend; two days starts a new one.
 */
export function groupIntoWeekends(races: WeekendRace[]): RaceWeekend[] {
  const sorted = [...races].sort((a, b) => a.date.localeCompare(b.date))
  const weekends: RaceWeekend[] = []
  let current: RaceDay[] = []

  const flush = () => {
    if (current.length === 0) return
    const all = current.flatMap((d) => d.races)
    weekends.push({
      days: current,
      firstDate: current[0].date,
      lastDate: current[current.length - 1].date,
      venues: [...new Set(all.map((r) => r.venue).filter((v): v is string => !!v))],
    })
    current = []
  }

  for (const race of sorted) {
    const last = current[current.length - 1]
    if (!last) {
      current.push({ date: race.date, races: [race] })
      continue
    }
    if (last.date === race.date) {
      last.races.push(race)
      continue
    }
    // More than one clear day between them, and it is a different weekend.
    if (addDays(last.date, 1) < race.date) flush()
    current.push({ date: race.date, races: [race] })
  }
  flush()

  return weekends
}

/**
 * The weekend to put in front of the officer, or null.
 *
 * Melissa, 2026-11-27: "the block should appear the Monday before the races, as
 * long as no others are scheduled." So: the nearest weekend that has not
 * finished, shown from the Monday of the week its first race falls in. A later
 * weekend cannot jump ahead of one still running, and nothing appears in the
 * quiet weeks between.
 *
 * @param today 'YYYY-MM-DD' in Pacific. Injected so the boundaries are testable
 *              rather than depending on when the suite happens to run.
 */
export function visibleWeekend(
  races: WeekendRace[],
  today: string
): RaceWeekend | null {
  const upcoming = groupIntoWeekends(races)
    .filter((w) => w.lastDate >= today)
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate))

  const next = upcoming[0]
  if (!next) return null
  return today >= mondayOf(next.firstDate) ? next : null
}

/**
 * Who a set of races would reach, counted as people rather than as entries.
 *
 * The union is the whole point. Summing each race's reach is the double-count
 * that has already been wrong twice in this codebase — once creating a temp
 * racer per race, once telling an officer a 45-person file would create 47
 * people. Here it would promise a text to more humans than exist.
 */
export function reachOf(races: WeekendRace[]): number {
  const seen = new Set<string>()
  for (const r of races) for (const id of r.eligiblePersonIds) seen.add(id)
  return seen.size
}

/**
 * Everyone entered across a set of races, as people.
 *
 * Shown beside `reachOf` so the screen can say "28 of the 45 racing" rather
 * than "the 28 racing", which was a plain untruth: 45 are racing and 28 have
 * opted in. The gap is worth seeing on the one screen where it costs something.
 */
export function entrantsOf(races: WeekendRace[]): number {
  const seen = new Set<string>()
  for (const r of races) for (const id of r.entrantPersonIds) seen.add(id)
  return seen.size
}

/** Every race on the given days, in running order. */
export function racesOnDays(weekend: RaceWeekend, dates: string[]): WeekendRace[] {
  const wanted = new Set(dates)
  return weekend.days.filter((d) => wanted.has(d.date)).flatMap((d) => d.races)
}

/**
 * "Sat 6" — short, because these are chips on a phone held in a glove.
 *
 * Built from the string rather than from `new Date(iso)`, which would parse to
 * UTC midnight and render the day before in Pacific time.
 */
export function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()]
  return `${weekday} ${d}`
}

/** "5–7 March", or "6 December" when a weekend is one day. */
export function weekendLabel(weekend: RaceWeekend): string {
  const month = (iso: string) =>
    [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ][Number(iso.split('-')[1]) - 1]
  const day = (iso: string) => Number(iso.split('-')[2])

  if (weekend.firstDate === weekend.lastDate) {
    return `${day(weekend.firstDate)} ${month(weekend.firstDate)}`
  }
  if (month(weekend.firstDate) === month(weekend.lastDate)) {
    return `${day(weekend.firstDate)}–${day(weekend.lastDate)} ${month(weekend.lastDate)}`
  }
  return `${day(weekend.firstDate)} ${month(weekend.firstDate)} – ${day(weekend.lastDate)} ${month(weekend.lastDate)}`
}

/**
 * Finding a race's live-timing id, rather than transcribing it.
 *
 * Live-timing publishes a static text file per day listing every race it hosted
 * nationwide — for 2026-03-07 that is 142 races — in the same pipe-delimited
 * format as its race payload:
 *
 *     https://www.live-timing.com/dailyRaces/<year>/races_<YYYY-MM-DD>.txt
 *
 * So the id for a scheduled race can be looked up from its date, venue and
 * discipline. See migration/live-timing-format.md, which worked this out, and
 * migration/harvest-live-timing-ids.mjs, which does the same job for the
 * historical archive. The matching rules here are ported from that script
 * rather than reinvented: it recovered ids for the whole archive, so its
 * venue aliases and masters-detection are tested against real data in a way
 * anything written fresh would not be.
 *
 * EVERYTHING IN THIS FILE IS PURE except `fetchDailyRaces`. The matching is the
 * part that can be wrong in a way nobody notices — a plausible id for the wrong
 * race compares or imports somebody else's results — so it is testable without
 * a network.
 */

/** One race in a day's nationwide listing. */
export interface DailyRace {
  /** `hID` — the live-timing race id. */
  id: string
  /** `hR` — the venue, as live-timing spells it. */
  venue: string
  /** `hN` — the race name, e.g. "BERNARD CUP MASTERS GS1". */
  name: string
  /** `hT` — discipline and category, e.g. "Giant Slalom=Masters". */
  type: string
  /** `hST` — start time, e.g. "10:00 AM". */
  startTime: string
}

/**
 * Venue names as FWM writes them, mapped to the substrings live-timing uses.
 *
 * Palisades Tahoe was Squaw Valley until the 2021-22 season, and the merged
 * resort's two base areas appear under several names.
 */
const VENUE_ALIASES: Record<string, string[]> = {
  palisades: ['palisades', 'squaw', 'alpine meadows', 'olympic valley'],
  palisadestahoe: ['palisades', 'squaw', 'olympic valley'],
  squaw: ['squaw', 'palisades', 'olympic valley'],
  alpine: ['alpine meadows', 'alpine', 'palisades'],
  alpinemeadows: ['alpine meadows', 'alpine', 'palisades'],
  mammoth: ['mammoth'],
  mammothmountain: ['mammoth'],
  sugarbowl: ['sugar bowl', 'sugarbowl'],
  northstar: ['northstar'],
  northstarcalifornia: ['northstar'],
  diamondpeak: ['diamond peak', 'diamondpeak'],
  heavenly: ['heavenly'],
  mtrose: ['mt. rose', 'mt rose', 'rose'],
  boreal: ['boreal'],
  kirkwood: ['kirkwood'],
  sierra: ['sierra'],
  sierraattahoe: ['sierra'],
  bigsky: ['big sky'],
  bigskyresort: ['big sky'],
}

/** Discipline codes, and how live-timing spells them in `hT`. */
const DISCIPLINE_NAMES: Record<string, string> = {
  SL: 'slalom',
  GS: 'giant slalom',
  SG: 'super',
  DH: 'downhill',
  AC: 'combined',
}

/** The daily file's URL. One request per DATE, never per race. */
export function dailyRacesUrl(date: string): string {
  return `https://www.live-timing.com/dailyRaces/${date.slice(0, 4)}/races_${date}.txt`
}

/**
 * Split a daily file into race records.
 *
 * Records separated by `~`, fields `key=value` separated by `|`. The first
 * occurrence of a key wins, because records repeat some keys.
 */
export function parseDailyFile(text: string): DailyRace[] {
  const races: DailyRace[] = []
  for (const record of text.split('~')) {
    const fields: Record<string, string> = {}
    for (const kv of record.split('|')) {
      const i = kv.indexOf('=')
      if (i > 0) {
        const key = kv.slice(0, i)
        if (!(key in fields)) fields[key] = kv.slice(i + 1)
      }
    }
    if (fields.hID) {
      races.push({
        id: fields.hID,
        venue: fields.hR ?? '',
        name: fields.hN ?? '',
        type: fields.hT ?? '',
        startTime: fields.hST ?? '',
      })
    }
  }
  return races
}

/** Minutes since midnight, so a day's races can be put in running order. */
export function startMinutes(startTime: string): number {
  const m = startTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[3])) h += 12
  return h * 60 + parseInt(m[2], 10)
}

/**
 * The race number live-timing puts in the name.
 *
 *   'BERNARD CUP MASTERS GS1'           -> 1
 *   'FW MASTERS SPEED SERIES - SG3 NSS' -> 3
 *   'ALPINE MEADOWS MASTERS GS'         -> null, only one race that day
 *
 * The LAST discipline-plus-digit is taken: names sometimes mention a discipline
 * earlier for another reason, as in 'FAR WEST MASTERS SG / DH - GS1'.
 */
export function raceNumberFromName(name: string): number | null {
  const matches = [...name.matchAll(/\b(SL|GS|SG|DH|AC)\s*(\d)\b/gi)]
  if (!matches.length) return null
  return parseInt(matches[matches.length - 1][2], 10)
}

/**
 * The races at a venue that could be this one, in running order.
 *
 * REQUIRES THE RACE TO LOOK LIKE A MASTERS EVENT. Live-timing lists over a
 * hundred races a day, including NASTAR and junior events at the very same
 * resorts on the very same day — venue and discipline alone would match those
 * too, and an id for a junior GS looks exactly as plausible as the right one.
 */
export function candidatesFor(
  races: DailyRace[],
  { venue, discipline }: { venue: string | null; discipline: string | null }
): DailyRace[] {
  const key = (venue ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const aliases = VENUE_ALIASES[key] ?? (venue ? [venue.toLowerCase()] : [])
  const discName = discipline ? DISCIPLINE_NAMES[discipline.toUpperCase()] : null

  return races
    .filter((r) => {
      if (!aliases.some((a) => r.venue.toLowerCase().includes(a))) return false

      const type = r.type.toLowerCase()
      const name = r.name.toLowerCase()
      if (!type.includes('master') && !name.includes('master')) return false

      if (discName && !type.includes(discName)) return false
      return true
    })
    .sort((a, b) => startMinutes(a.startTime) - startMinutes(b.startTime))
}

export interface Suggestion {
  /** Null when nothing matched, or when the match is ambiguous. */
  id: string | null
  /** Why — shown to the officer, who is confirming rather than trusting. */
  reason: string
  /** Everything at that venue and discipline, so a wrong guess is visible. */
  candidates: DailyRace[]
}

/**
 * Suggest an id for one scheduled race.
 *
 * @param sequence Which race of its kind that day — FWM names them "1 of 2".
 *
 * NEVER GUESSES BETWEEN EQUALS. Where a venue ran two races of one discipline
 * and nothing distinguishes them, this returns no id and says so. A wrong id
 * imports another race's results under this one's name, which is worse than
 * asking somebody to look.
 */
export function suggestId(
  races: DailyRace[],
  race: { venue: string | null; discipline: string | null; sequence: number | null }
): Suggestion {
  const candidates = candidatesFor(races, race)

  // TWO DIFFERENT NOTHINGS. Live-timing publishes the day's file well before it
  // has any races in it — on 2026-11-27 the file for 5 December existed and
  // held nothing but a timestamp. "They have not listed it yet, come back" and
  // "they listed 143 races and none of them is yours" need different answers
  // from the officer, so they get different sentences.
  if (races.length === 0) {
    return {
      id: null,
      reason: 'live-timing has not listed any races for that day yet',
      candidates,
    }
  }

  if (candidates.length === 0) {
    return {
      id: null,
      reason: `live-timing lists ${races.length} races that day, none a masters race at that venue`,
      candidates,
    }
  }

  if (candidates.length === 1) {
    return { id: candidates[0].id, reason: 'the only masters race there', candidates }
  }

  // Preferred: pair on the number live-timing puts in the name. More reliable
  // than start-time order, which the two sources do not always agree on.
  const wanted = race.sequence ?? 1
  const byNumber = new Map<number, DailyRace>()
  for (const c of candidates) {
    const n = raceNumberFromName(c.name)
    if (n !== null && !byNumber.has(n)) byNumber.set(n, c)
  }
  const numbered = byNumber.get(wanted)
  if (numbered) {
    return {
      id: numbered.id,
      reason: `race ${wanted} of the day, from its name`,
      candidates,
    }
  }

  return {
    id: null,
    reason: `${candidates.length} masters races there and nothing to tell them apart — pick one`,
    candidates,
  }
}

/**
 * Fetch one day's listing.
 *
 * Politely, as migration/live-timing-format.md asks: a descriptive user agent,
 * and one request per date rather than per race. Sends nothing but the date —
 * no member data leaves this system.
 */
export async function fetchDailyRaces(date: string): Promise<DailyRace[]> {
  const res = await fetch(dailyRacesUrl(date), {
    headers: { 'User-Agent': 'FarWestMasters-admin/1.0 (race id lookup)' },
    // The schedule does not change; a day old is fine and spares their server.
    next: { revalidate: 86_400 },
  })
  if (!res.ok) return []
  return parseDailyFile(await res.text())
}

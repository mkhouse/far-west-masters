/**
 * Every fixture here is a real record, trimmed from the cached live-timing
 * payloads in ../fwm-results-archive/_live-timing-races.
 *
 * The traps are numbered as in migration/live-timing-format.md. None of them
 * throws in production — each produces a plausible, wrong answer — so each gets
 * a test naming what the wrong answer would have been.
 */
import { describe, expect, it } from 'vitest'
import { normalizeName, parseLiveTiming, refusalReason } from './parseLiveTiming.js'

const HEADER =
  'hN=BERNARD CUP MASTERS GS1|hT=Giant Slalom=Masters|hR=PALISADES TAHOE|' +
  'hST=3/7/2026 10:00 AM|hID=306870|hM=NO DSQs RUN 2'

const racer = (fields: string) => `|b=${fields}`

/** Real: race 306870, bib 96. Open Class, both runs, 44.75 + 45.25. */
const OPEN_CLASS_FINISHER =
  '96|m=Birkner de Miguel, Tomas|ms=772919511.86607|t=OP|s=M1|un=X7032715|up=0|fp=0|' +
  'r1=44.75=44750|r2=45.25=45250|tt=1:30.00'

/** Real: race 197855. `tt` holds only run 1 although both runs completed. */
const TT_IS_ONLY_RUN_ONE =
  '21|m=Someone, Real|s=M7|un=F1234567|r1=49.53=49530|r2=51.23=51230|tt=49.53'

describe('trap 1 — Open Class lives in `t`, not the class field', () => {
  it('reads OP as Open Class while the age class stays populated', () => {
    const { racers } = parseLiveTiming(HEADER + racer(OPEN_CLASS_FINISHER))
    expect(racers[0]!.isOpenClass).toBe(true)
    // The trap: `s` still says M1, so reading only `s` loses the distinction
    // for about a third of the field.
    expect(racers[0]!.ageClass).toBe('M1')
    expect(racers[0]!.division).toBeNull()
  })

  it('treats a national division code as a division, not Open Class', () => {
    const { racers } = parseLiveTiming(
      HEADER + racer('7|m=Gunn, Robert|t=FW|s=M8|un=F7267740|r1=1:26.44=86440|r2=1:18.13=78130')
    )
    expect(racers[0]!.isOpenClass).toBe(false)
    expect(racers[0]!.division).toBe('FW')
  })
})

describe('trap 2 — a single-run race still emits r2, filled with DNS', () => {
  const SUPER_G =
    HEADER +
    racer('1|m=A, One|s=M5|r1=1:00.02=60020|r2=DNS=2147483607|tt=1:00.02') +
    racer('2|m=B, Two|s=M6|r1=1:00.07=60070|r2=DNS=2147483607|tt=1:00.07')

  it('does not report every racer as a non-finisher', () => {
    const race = parseLiveTiming(SUPER_G)
    expect(race.twoRuns).toBe(false)
    // The trap: r2 is a placeholder for a run that never existed. Treating it
    // as a result makes the whole field DNS.
    expect(race.racers.every((r) => r.status === null)).toBe(true)
    expect(race.racers[0]!.total).toBe('1:00.02')
    expect(race.racers[0]!.run2).toBe('')
  })

  it('decides it across the field, not per racer', () => {
    // One real second-run time anywhere means the race had two runs — and then
    // a racer whose r2 is DNS really did fail to start it.
    const mixed =
      HEADER +
      racer('1|m=A, One|s=M5|r1=30.00=30000|r2=31.00=31000') +
      racer('2|m=B, Two|s=M6|r1=30.50=30500|r2=DNS=2147483607')
    const race = parseLiveTiming(mixed)
    expect(race.twoRuns).toBe(true)
    expect(race.racers[1]!.status).toBe('DNS')
    expect(race.racers[1]!.total).toBeNull()
  })
})

describe('trap 3 — `tt` shows a time even when a run was disqualified', () => {
  it('reports a disqualification rather than a finish', () => {
    const race = parseLiveTiming(
      HEADER +
        racer('5|m=C, Three|s=M4|r1=42.93=42930|r2=DQg23|tt=42.93') +
        racer('6|m=D, Four|s=M4|r1=43.10=43100|r2=44.00=44000')
    )
    // The trap: tt=42.93 reads as a finish, which turns an overturned or newly
    // applied DSQ into what looks like an ordinary time correction — the single
    // most interesting thing a preliminary-to-official diff can show.
    expect(race.racers[0]!.status).toBe('DSQ')
    expect(race.racers[0]!.total).toBeNull()
  })
})

describe('trap 4 — `tt` is sometimes only run 1 even when both runs completed', () => {
  it('recomputes the total from the runs', () => {
    const { racers } = parseLiveTiming(HEADER + racer(TT_IS_ONLY_RUN_ONE))
    // tt says 49.53. The official total for this real record is 1:40.76.
    expect(racers[0]!.total).toBe('1:40.76')
    expect(racers[0]!.totalSeconds).toBeCloseTo(100.76, 5)
  })

  it('truncates to hundredths rather than rounding', () => {
    // Ski times are truncated; rounding disagrees with ACE on about half the
    // field. 30.005 + 30.005 is 60.01, not 60.02.
    const { racers } = parseLiveTiming(
      HEADER + racer('9|m=E, Five|s=M2|r1=30.005=30005|r2=30.005=30005')
    )
    expect(racers[0]!.totalSeconds).toBeCloseTo(60.01, 5)
  })
})

describe('trap 5 — preliminary data can be incomplete', () => {
  it('refuses a two-run race that only has run 1', () => {
    const halfARace =
      HEADER +
      racer('1|m=A, One|s=M5|r1=30.00=30000|r2=DNS=2147483607') +
      racer('2|m=B, Two|s=M6|r1=30.50=30500|r2=DNS=2147483607')
    const race = parseLiveTiming(halfARace)
    expect(refusalReason(race, true)).toMatch(/half a race/)
    // The same payload is a complete super-G when the schedule says one run.
    expect(refusalReason(race, false)).toBeNull()
  })

  it('refuses a race with nobody in it', () => {
    expect(refusalReason(parseLiveTiming(HEADER))).toMatch(/no racers/)
  })

  it('refuses a race where nobody has a complete time', () => {
    const race = parseLiveTiming(
      HEADER + racer('1|m=A, One|s=M5|r1=DNS=2147483607|r2=DNS=2147483607')
    )
    expect(refusalReason(race)).toMatch(/complete time/)
  })
})

describe('trap 6 — names carry formatting noise', () => {
  it('normalises a stray space before the comma', () => {
    // Real: live-timing has "Hlubucek , Mark" where official has "Hlubucek, Mark".
    expect(normalizeName('Hlubucek , Mark')).toBe(normalizeName('Hlubucek, Mark'))
  })

  it('keeps the original spelling alongside the normalised one', () => {
    const { racers } = parseLiveTiming(HEADER + racer('3|m=Hlubucek , Mark|s=M8'))
    expect(racers[0]!.name).toBe('Hlubucek , Mark')
    expect(racers[0]!.normalizedName).toBe('hlubucek, mark')
  })
})

describe('the header and identity', () => {
  it('reads the race header', () => {
    const race = parseLiveTiming(HEADER + racer(OPEN_CLASS_FINISHER))
    expect(race).toMatchObject({
      id: '306870',
      name: 'BERNARD CUP MASTERS GS1',
      venue: 'PALISADES TAHOE',
      notes: 'NO DSQs RUN 2',
    })
  })

  it('carries the USSA number, which is the stable key', () => {
    const { racers } = parseLiveTiming(HEADER + racer(OPEN_CLASS_FINISHER))
    expect(racers[0]!.usssa).toBe('X7032715')
  })

  it('skips records with no name', () => {
    expect(parseLiveTiming(HEADER + racer('4|s=M9|r1=30.00=30000')).racers).toEqual([])
  })
})

describe('didNotStart — distinct from a non-finish', () => {
  it('is true only when they never left the gate', () => {
    const race = parseLiveTiming(
      HEADER +
        racer('1|m=Never, Started|s=M5|r1=DNS=2147483607|r2=DNS=2147483607') +
        racer('2|m=Started, Then|s=M5|r1=30.00=30000|r2=DNS=2147483607') +
        racer('3|m=Finished, Both|s=M5|r1=30.00=30000|r2=31.00=31000')
    )
    expect(race.racers.map((r) => r.didNotStart)).toEqual([true, false, false])
    // Both of the first two are DNS by status; only one never raced at all.
    // In the official results the non-starter disappearing is routine, and the
    // one who started and vanished is worth a look.
    expect(race.racers.map((r) => r.status)).toEqual(['DNS', 'DNS', null])
  })
})

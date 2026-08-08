# FWM results engine

The scoring logic for Far West Masters races, plus the harnesses that prove it
reproduces the official results.

This is the code the application imports — there is deliberately only one copy of
the scoring rules, so the engine that is verified below is the same engine that runs
in production.

## Why the verification matters

FWM results have been scored for decades by ACE Scoring, a system only one person
operates. Replacing it is not a technical problem so much as a trust problem: the
new system has to demonstrably produce the same numbers before anyone should rely
on it.

So the engine is checked against **every result FWM has published since 2009**,
using the club's own public archive as the answer key. Nothing here depends on
access to the existing system.

## The harnesses

Run from this directory. Each needs the local mirror created by
`node migration/archive-results.mjs --all` (see [../migration/README.md](../migration/README.md)).

| Command | Checks | Result |
|---|---|---|
| `npm run parity` | class rank and race points, per race | rank **100%** (14,926/14,926), points **99.8%** |
| `npm run standings` | season totals, best-N, tie notation, starts/finishes | **100%** on all four (3,018 racer-seasons) |
| `npm run cups` | handicapped cup times and positions | position **100%**, handicap time **96.3%** |
| `npm run prelim` | live-timing preliminary vs official results | 85.5% of racers identical |

Add `--verbose` to list every mismatch, `--season 2026` to narrow, `--out FILE` to
write a markdown report.

**Every remaining difference in the first three is exactly 0.01**, and the cause is
established — see the "READ FIRST" section of
[../migration/scoring-history.md](../migration/scoring-history.md). In ski racing a
hundredth is never dismissed as noise, so that gap is explained rather than rounded
away.

## Layout

```
src/
  types.ts           scoring constants and per-season rules (factors, points scales)
  time.ts            time parsing and formatting — note: times TRUNCATE, not round
  scoring.ts         class rank, race points, class points for one race
  standings.ts       best-N season totals and tie handling
  cups.ts            age-handicapped cup scoring
  parseAce.ts        parser for ACE Scoring's published results
  parseStandings.ts  parser for published season standings
bin/
  parity-report.ts     race scoring vs published
  standings-parity.ts  season standings vs published
  cup-parity.ts        cup results vs published
  prelim-parity.ts     live-timing preliminary vs official
```

## Things that will bite you

- **Times truncate; race points round.** `171.1850` is `171.18`, not `171.19`.
  Getting this backwards disagrees with the official results on roughly half the
  field. See `truncateToHundredths()` in `time.ts`.
- **Scoring rules are per season.** Discipline factors changed five times since
  2009, the points scale changed in 2016, and age groups went from ten-year to
  five-year bands in 2010. Always score a race with `factorsForSeason()` and
  `pointsScaleForSeason()`, never with today's constants.
- **Historical results are displayed as published, never recomputed.** Recomputing a
  2012 standings page under 2026 rules produces a confidently wrong answer.
- **Parsing live-timing has six documented traps**, none of which raise an error.
  Read [../migration/live-timing-format.md](../migration/live-timing-format.md)
  before touching that path.

## Where the rules came from

Every rule was measured from FWM's own published results rather than taken from
memory, and each measurement is reproducible with the scripts in `../migration/`.
[../migration/scoring-history.md](../migration/scoring-history.md) records what was
found, how, and what is still unverified.

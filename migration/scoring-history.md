# FWM scoring rule history

Every rule in this document was **derived from FWM's own published results**, not
from memory or documentation. Each one is reproducible: the scripts that measured
them are in this folder, and the source data is the public archive at
classic.farwestmasters.org.

That matters because these rules are what make historical results explainable. A
2012 standings page cannot be understood — let alone recomputed — under 2026 rules.

Seasons are identified by their **ending year**: 2026 means the 2025-26 season.

---

# READ FIRST — why a few recomputed values differ by 0.01

**This is the question to expect from anyone checking our work, so here is the whole
answer in one place.**

## The headline

We recomputed every published FWM result from 2009 to 2026 — 16,852 individual
results across 297 races — and compared them against ACE Scoring's own published
numbers.

**78 values differ. Every single one differs by exactly 0.01. Nothing differs by
more.** No placement, no season standing, and no cup position is affected.

| What we checked | Agreement |
|---|---|
| Race class rank (who beat whom) | **100.00%** — 14,926 of 14,926 |
| Season standings: points, rank, starts, finishes | **100.00%** — 3,018 of 3,018 |
| Cup positions, including ties | **100.00%** — 2,003 of 2,003 |
| Cup raw combined times | **100.00%** — 1,274 of 1,274 |
| Race points | 99.79% — 14,957 of 14,988 (**31 differ, each by 0.01**) |
| Cup handicapped times | 96.31% — 1,227 of 1,274 (**47 differ, each by 0.01**) |

## The cause, in one sentence

ACE calculates from the timing system's full precision, but *publishes* times rounded
to hundredths — so when we recalculate from those published times, a value sitting a
fraction of a cent away from a rounding boundary can land on the other side.

An example. In the 2026 Mammoth SG, the exact race points work out to **109.43494…**,
which is `0.0001` below the 109.435 boundary. We publish 109.43; ACE published 109.44.
Both are correct arithmetic — ACE simply had a winner's time carrying more digits than
the `1:10.79` printed on the page.

## Why we know it is precision and not a disagreement about the formula

This was tested rather than assumed:

1. **Every algebraic form of the race-points formula gives identical results.**
   `F×tx/to − F`, `F×(tx−to)/to`, `F×(tx/to − 1)`, and an integer-centisecond
   variant all produce the same matches and the same misses.
2. **The rounding rule matches.** Rounding by ceiling or floor instead of
   round-half-up drops agreement to 65% and 64%. ACE rounds the way we do.
3. **The differences run in both directions** — 19 of ours higher, 9 lower. A
   genuine rule difference would skew consistently one way; only lost precision
   scatters.
4. **Solving each case backwards** for the winner time that would reproduce ACE's
   published value requires a correction of **0.27 to 0.66 milliseconds** — every
   one smaller than half a hundredth, so every implied time still prints as the
   same published hundredth.

For the cups it compounds slightly: we add two per-race times that were each already
truncated for publication, whereas ACE adds full-precision times and truncates once
at the end.

## Why this does not affect the new system

The 0.01 gap comes from re-deriving history out of already-rounded public web pages.
It is a limitation of that *source data*, not of the calculation.

- **Historical seasons** are displayed exactly as published. We do not recompute
  them, so nothing a racer sees ever changes.
- **New races** are imported from the timing source, where full precision is
  available — so results are reproducible to the last digit.

`results.total_seconds` is stored as `numeric(9,3)` for this reason: keep every digit
the source gives, round only for display.

## If a number ever does not match

Work down this list in order:

1. **Is it exactly 0.01?** Then it is this, and it is expected. Check whether the
   input came from a published page rather than the timing file.
2. **Is it a time, and off by a cent?** Times are **truncated**, never rounded
   (§4) — 171.1850 is 171.18. Race points are the opposite: they round.
3. **Is it a whole placement?** Check ties (`3(t)`), Open Class exclusion, and age
   class 0 (§6) — a `(W00)` racer is below masters age and always sorts last.
4. **Is it an older season?** Check the era tables below: discipline factors changed
   five times, the points scale changed in 2016, age groups changed in 2010, and
   cups do not all use the same method.
5. **Still unexplained?** Re-run `npm run parity`, `npm run standings` and
   `npm run cups` in `results-engine/`. They print every mismatch with `--verbose`,
   and they audit their own coverage, so a silently skipped row shows up as a
   dropped-row count rather than as a flattering percentage.

---

## 1. Discipline factors (race points)

Race points use the US Ski & Snowboard formula `points = F × (Tx / To) − F`, where
`F` is the discipline factor.

The factors below are **measured from FWM's own published results**, not taken from a
rule book. They changed five times between 2009 and 2019, which is consistent with
US Ski & Snowboard periodically revising them — though the reason is inferred; only
the values themselves are established here.

| Seasons | SL | GS | SG | DH |
|---|---:|---:|---:|---:|
| 2009 – 2010 | 600 | 880 | 1060 | 1320 |
| 2011 – 2012 | 610 | 870 | 1060 | — |
| 2013 – 2014 | 620 | 890 | 1050 | — |
| 2015 – 2018 | 720 | 980 | 1080 | — |
| **2019 – present** | **730** | **1010** | **1190** | **1250** |

**How these were derived.** The formula inverts cleanly: `F = points ÷ (Tx/To − 1)`.
Since every published race file contains both the times and the resulting race
points, F can be solved for directly and the median taken across all racers in a
season. The values came out to clean round numbers, which is a strong signal the
derivation is correct.

Implemented as `DISCIPLINE_FACTOR_ERAS` / `factorsForSeason()` in
`results-engine/src/types.ts`.

---

## 2. Class points scale

Points awarded by finishing position within a class.

| Seasons | Scale | Depth |
|---|---|---|
| 2009 – **2015** | 25, 20, 15, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 | top **15** |
| **2016** – present | 100, 80, 60, 50, 45, 40, 36, 32, 29, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 | top **30** |

Measured by `detect-points-scale.mjs`, which reads the `points (rank)` pairs printed
in each season's standings pages. The changeover is unambiguous: a win was worth 25
points in 2015 and 100 points in 2016.

The two eras are not comparable: 20th place was worth **0 points** under the old
scale and **11 points** today. Season standings must therefore always be displayed
under the rules of their own season, never recomputed under current ones.

---

## 3. Age classes: ten-year → five-year groups (2010)

| Seasons | Groups | Header format | Codes |
|---|---|---|---|
| through 2009 | **ten-year** | `Men 80+`, `Women 70` | `M30`, `M40`, `W50` |
| 2010 onward | **five-year** | `Men Class 12 (80-84)` | `M01`…`M13`, `W01`…`W13` |

The codes are dangerously similar: legacy `M40` means "man in his 40s"; modern `M04`
means "class 4, ages 40-44".

Practical consequence: a parser matching `/(men|women)\s+class\s+(\d+)/` silently
returns **nothing** for a pre-2010 file, because those headers contain no "Class" at
all. `parseAce.ts` handles both.

### Top class boundary

| Seasons | Class 13 |
|---|---|
| 2010 – 2011 | `85+` (open-ended) |
| current | `85-89` (bounded) |

This plausibly explains why `cup-results-calc.js` defines a class 14 (ages 90-110):
once class 13 was bounded at 89, a 90+ class would be needed. That connection is an
inference, not something the records state.

What the records do show: **no class 14 appears anywhere in the archive**, so its
handicap has never been exercised in a published result.

---

## 4. Times are TRUNCATED, not rounded

Ski racing times are truncated to hundredths. A combined time of `171.1850` is
published as **171.18**, not 171.19.

This was established from the published cup results: comparing our computed
handicapped times against ACE's, ordinary rounding agreed on only ~50% of racers
while truncation agreed on 96%. Every remaining difference is exactly 0.01.

`truncateToHundredths()` in `results-engine/src/time.ts` implements this, and
`secondsToDisplay()` uses it.

Note the distinction: **times** truncate, but **race points** round — race points
matched at 99.8% using round-half-up, and ceiling/floor scored 65%/64%. They are a
computed score rather than a measured time, and follow the ordinary convention.

## 5. Open Seed became Open Class in 2016

Two different systems, sharing one scoring shape.

| Seasons | Name | How a racer got in |
|---|---|---|
| through 2015 | **Open Seed** | Earned on the day — after run 1, the fastest 5 women and 10 men across all age classes were pulled out to run second out of the normal age order |
| 2016 onward | **Open Class** | Declared in advance — the racer opts in with the scoring director by noon the day before |

Confirmed by the official rules ("A new system for the Open class ... was
established starting in the 2015-2016 season") and by the archive, which shows a
clean break: Open Seed appears in every season 2009-2015 and never after; Open
Class appears from 2016 and never before.

The eligibility rule changed completely, but the *scoring* shape did not. In both
eras the racer is ranked against all ages, carries their age class as a suffix
(`Belden, Kurt (M50)`), and appears in their own age class only as a starred stub
row. So both map to one scoring class in the engine.

Open Seed membership must never be *derived* — it depended on run-1 times on the
day. Read it from the published results.

## 6. Age class 0 is below masters age

A racer shown as `(W00)` sits under the youngest masters class (class 1 is 18-29) —
in practice a junior racing as a guest. The handicap scale starts at class 1, so
there is nothing to apply: ACE assigns a `999:00.00` sentinel and places them last
regardless of speed. Barnhart, Lindsay (W00) won both runs of the 2015 Bernard Cup
and was still published 8th of 8.

This is distinct from a *missing* age class on a genuine masters racer, which should
surface as a data problem to correct rather than being silently placed last.

## 7. Cup scoring

See [`cup-rules.md`](cup-rules.md) for detail. In brief, the three cups are **not** scored alike:

- **Bernard Cup** — age-handicapped combined time (1985 → present)
- **Viva Italia** — age-handicapped since 1997; before that, the "Gianotti Criteria",
  which was subjective and has no formula to reproduce
- **McKinney Cup / Silver Dollar Derby** — **no handicap at all**; fastest raw
  combined time for the weekend

---

## 8. Formats handled, and what is genuinely empty

Every section heading that appears anywhere in the archive is now parsed. The
harnesses count the `racerEntry` rows in each source file and compare that against
the rows they actually checked; all three report **0 dropped rows**.

| Format | Seasons | Status |
|---|---|---|
| `Men Class 12 (80-84)` | 2010 – present | handled |
| `Men 80+`, `Women 70` (ten-year groups) | through 2009 | handled |
| `Men 18-20` (junior band) | one early season | handled |
| `Men Open Class` | 2016 – present | handled |
| `Men Open Seed` | through 2015 | handled |
| Single-run races (no run1/run2 cells) | all | handled |
| Non-finishers (`-` position, no points cell) | all | handled |

**Four 2009 files contain no results** — `20090123-Mammoth-SG`, `20090124-Mammoth-SG`
(both runs) and `20090125-Mammoth-GS`. These are not a parser gap: all four are
**byte-identical** to each other (same MD5, 6,116 bytes) and contain zero
`racerEntry` and zero `groupHeader` rows. They are the site's empty placeholder page,
published for races whose results never went up. There is nothing there to read.

---

## Verification status

`npm run parity` in `results-engine/` recomputes every archived race and compares
against ACE Scoring's published numbers:

| Check | Command | Result |
|---|---|---|
| Race class rank | `npm run parity` | **100.0%** (14,926 / 14,926) |
| Race points | `npm run parity` | **99.8%** (14,957 / 14,988) |
| Season total points | `npm run standings` | **100.0%** (3,018 / 3,018) |
| Season class rank (incl. ties) | `npm run standings` | **100.0%** (3,018 / 3,018) |
| Season starts / finishes | `npm run standings` | **100.0%** (3,018 / 3,018) |
| Cup handicap time | `npm run cups` | **96.3%** (1,227 / 1,274) |
| Cup raw combined time | `npm run cups` | **100.0%** (1,274 / 1,274) |
| Cup position (incl. ties) | `npm run cups` | **100.0%** (2,003 / 2,003) |

Coverage: 297 races and **16,852 individual results** across 18 seasons (2009-2026),
3,018 racer-seasons of standings, and every age-handicapped cup from 2010 onward.

### Coverage is audited, not assumed

An earlier version of these numbers was inflated. The parser was silently skipping
every `Men Open Seed` / `Women Open Seed` section — **1,679 rows, 9.96% of the
field** — which were counted as neither pass nor fail. A percentage computed over
an unaudited denominator is not evidence.

The harnesses now verify that every `racerEntry` row present in the source HTML is
accounted for. Race files, standings pages and cup pages all report **0 dropped
rows**. Re-running with the missing 10% included left the match rates unchanged.

### What this verification does NOT cover

Stated plainly, because the limits matter as much as the results:

- **Pre-2010 cups are not verified.** They ran under the ten-year age scheme with a
  different handicap arrangement, and are historical records to display, not to
  recompute. Cup checks start at 2010.
- **The McKinney Cup / Silver Dollar Derby is not verified.** It is decided on raw
  combined time with no handicap, so it exercises none of the handicap logic.
- **Viva Italia before 1997 cannot be verified by anyone.** The "Gianotti Criteria"
  had no formula — the winner was chosen. Those records are facts to preserve.
- **The standings check tests aggregation, not the whole chain.** It rebuilds each
  racer's season from the per-race points printed on the published standings page,
  then verifies best-N selection, tie notation, starts and finishes. Those per-race
  points are separately verified end-to-end by the race harness, but the two are
  checked independently rather than as one pipeline.
- **2002 – 2008 are absent.** The archive index lists them as temporarily
  unavailable, so they are not mirrored and not checked.
- **Preliminary results are a different question.** These checks are all against
  official published results. Live-timing data carries only hundredths, so
  preliminary race points can legitimately differ from official ones — see
  [`live-timing-format.md`](live-timing-format.md).

### The remaining differences

31 race points and 47 cup handicap times differ, every one by exactly 0.01, and
nothing else differs at all.

**The full explanation, the evidence behind it, and what to check when a number does
not match are at the top of this document — see "READ FIRST".** It is placed there
because it is the first question anyone auditing this work will ask.

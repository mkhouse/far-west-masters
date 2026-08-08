# Preliminary vs official results

How the live-timing data available on race day compares with the official
results ACE Scoring publishes afterwards.

**The question this answers:** how confidently can preliminary results be
published at the venue, and what should the disclaimer actually say?

## Result

Races compared: **74** · racer records: **4453**

| outcome | count | share |
|---|---:|---:|
| identical | 3808 | 85.52% |
| did-not-start, dropped (expected) | 278 | 6.24% |
| added in official | 153 | 3.44% |
| time changed | 103 | 2.31% |
| removed (not a DNS) | 69 | 1.55% |
| class changed | 22 | 0.49% |
| status changed (DQ) | 20 | 0.45% |
| **meaningful changes** | **367** | **8.24%** |

## What it means

Most racers come through preliminary unchanged, and most of what does change
is **roster churn** — people added or removed — rather than corrections to
times or classes. Class and disqualification changes are both well under 1%.

So the race-day disclaimer should say **"who raced may still change"**, not
"these times may be wrong". The times are in good shape; the entry list is
what moves.

## Design consequences

1. **Refuse to publish an incomplete race.** If the official race has two runs
   and live-timing only has one, that is half a race — worse than publishing
   nothing. See the parsing traps in `live-timing-format.md`.
2. **Diff every official import against its preliminary** and have the
   processor review it. Roster changes are routine and can be summarised;
   a time correction or unexplained removal deserves attention.
3. **Allow a manual DQ override on preliminary results**, so accurate results
   can be announced while waiting for the timing file.

## Method and limits

Preliminary data comes from live-timing's race endpoint; official results come
from the archived ACE pages. Race ids were recovered automatically by
`migration/harvest-live-timing-ids.mjs`. Every racer is classified into exactly
one outcome, so the totals reconcile.

Limits worth stating:

- **Only reliably-matched races are counted.** Ids paired purely by start time
  are excluded by default, because a mis-ordered pair reports every racer as
  changed. Pass `--include-ordered` to see them.
- **1 race(s) excluded** where live-timing never received run 2.
- **The time-changed figure is mixed.** It combines genuine corrections,
  sub-hundredth rounding differences, and live-timing data errors (one racer
  shows a 2.64-second slalom run). Treat it as an upper bound.
- Seasons before 2019 are not covered; live-timing coverage of FWM is thinner.

Regenerate with `npm run prelim -- --out ../reports/preliminary-vs-official.md`.

# FWM cup rules and historical scoring eras

Sourced from the official cup pages on classic.farwestmasters.org:

- `/docs/specialevents/bernardcup.html`
- `/docs/specialevents/vivaitalia.html`
- `/docs/specialevents/mckinney-silver.html`

This matters for the archive and the career-results browser: **the same trophy was
not always scored the same way**, so historical cup results must be displayed as
published rather than recomputed under today's formula.

## The three cups

### Bernard Cup — age-handicapped, 1985 → present

Awarded to the top man and woman in the **age-handicapped** combined standings of the
Palisades Tahoe race weekend (Squaw Valley until the 2021-22 season). Created by Bob
Bernard, who devised the handicap system itself.

The formula is `BCTime = Time × (1 − HANDICAP × (ageClassNumber − 1))`.

**The rule is 3.0% for slalom and 2.5% for GS / combined.** That is what the
published handicap tables say, and what `airtable-results/cup-results-calc.js`
implements by selecting on each race's discipline.

**In practice the rate applied has varied**, so the system stores it per cup rather
than deriving it — see "[Handicap rates, measured](#handicap-rates-measured)" below.
The rule is the default; the stored value is what was actually used.

Not held 2021 (covid); races cancelled 2025 (weather).

### Viva Italia Trophy — **two distinct scoring eras**

| Era | Seasons | How it was scored |
|---|---|---|
| **Gianotti Criteria** | 1982 – 1996 | *Subjective.* Selection criteria "known only to him," announced at the awards banquet |
| **Age-Handicap Scoring** | 1997 – present | Fastest man/woman in the SL, using a handicap formula "similar to the Bernard Cup" |

The pre-1997 era **cannot be recomputed at all** — there was no formula, John Gianotti
simply chose. Those winners are historical facts to display, not results to derive.

Venue has also moved (originally the Heavenly Valley SL; currently Diamond Peak).

The official page says "similar to the Bernard Cup," not identical — and that
wording is doing real work. Viva Italia has used **0.03 in every measured season**,
while the Bernard Cup has generally used 0.025.

Not held 2021 (covid).

### McKinney Cup / Silver Dollar Derby — **no handicap at all**

| Era | Seasons | Name |
|---|---|---|
| 1985 – 2002 | Silver Dollar Derby |
| 2003 – present | McKinney Cup |

Both are awarded on **fastest total combined time for the weekend** — raw time, *no
age handicap*. This is a genuinely different calculation from the other two cups, and
applying the Bernard handicap to it would produce wrong winners.

Mt. Rose venue. Frequently cancelled for weather (2016, 2018, 2023, 2024); not held 2021.

## Handicap rates, measured

Solving each published racer's handicapped time back to a rate, across every cup
from 2010 to 2026:

| Cup | Rate | Exceptions |
|---|---|---|
| **Viva Italia** | **0.0300** | none — every measured season |
| **Bernard Cup** | **0.0250** | 2018 and 2020 used 0.0300 |
| **McKinney Cup** | n/a | no handicap at all |

**The applied rate cannot be derived from the disciplines of the paired races.** The
2015 and 2018 Bernard Cups were both all-slalom weekends yet were scored at
*different* rates — 0.025 and 0.03. Under the documented rule both should have been
0.03.

This is not evidence that the rule is wrong; it is evidence that the rate actually
used is a per-event fact. Deriving it from discipline reproduces the rulebook but not
the published results, and the published results are what racers were awarded on.

So: **default to the rule, store what was used, and let it be corrected.** Viva
Italia's consistent 0.03 is exactly what the rule predicts for a slalom trophy — the
Bernard Cup is where practice diverges.

### How the cup scoring screen should behave

1. **Suggest the rate from the rule.** Look at the paired races: all slalom → 3.0%,
   anything else → 2.5%. Pre-fill it, and say where the number came from.
2. **Allow it to be changed**, because practice has diverged and the person running
   the cup may know why.
3. **Confirm before accepting an override.** Something explicit — "this cup will be
   scored at 3.0% instead of the 2.5% the rule gives for GS. Are you sure?" — so a
   non-standard rate is always a decision, never a slip.
4. **Record what was used**, not what the rule says. `cups.handicap_rate` is the
   applied value, and it is what historical results must be reproduced with.

The reason for the friction rather than a free-text field: the handicap rate changes
*every* placing in the cup. A quietly wrong rate does not look wrong — it produces a
complete, plausible, incorrect result list, announced at an awards ceremony.

Stored as `cups.handicap_rate`, and implemented as an argument to `calculateCup()`
in `results-engine/src/cups.ts` — deliberately not inferred from the race disciplines.

Verified by `npm run cups`: handicapped times match the published values for 96.3%
of racers, and every difference is exactly 0.01 (the published-precision effect
described in [scoring-history.md](scoring-history.md)). Cup positions match 100%.

## Age classes changed from 10-year to 5-year groups in 2010

This is the single biggest historical break, and it affects **all** results — not just
cups. Verified directly against the archived result files:

| Seasons | Age groups | Header format in the HTML | Winner-list codes |
|---|---|---|---|
| through **2009** | **10-year** | `Women 80+`, `Men 80+`, `Women 70` | `M30`, `M40`, `W50` |
| **2010** onward | **5-year** | `Men Class 12 (80-84)` | `M01`…`M13`, `W01`…`W13` |

So `M40` in a pre-2010 file means "man in his 40s" (a ten-year band), while `M04` in a
modern file means "men's class 4, ages 40-44." Same-looking code, different meaning.

The consequence is concrete: `parseACEScoringHTML` matches on
`/(men|women)\s+class\s+(\d+)/i`, which **finds nothing** in a 2009 file — those
headers say `Women 80+`, with no "Class" at all. Pre-2010 results need a separate
parser branch, not a tweak.

### Top class boundary also moved

| Seasons | Class 13 |
|---|---|
| 2010 – 2011 | `85+` (open-ended) |
| 2026 | `85-89` (bounded) |

Which is where `cup-results-calc.js`'s mysterious **class 14 (ages 90-110)** comes
from: once class 13 became bounded at 89, a 90+ class was needed. Worth noting that
**no class 14 appears anywhere in the archived results** — nobody has raced in it yet,
so its handicap extrapolation is untested but also unexercised. Leave as is.

*(This resolves open question #2 in [`schema-design.md`](schema-design.md).)*

## Consequences for the build

1. **Never recompute historical cup results.** Store and display them as published.
   Recomputation is only valid for recent seasons where the current formula held.
2. **Cup type is a property of the cup, not a global setting** — `cups` needs a scoring
   method (`age_handicap` | `raw_combined` | `historical_only`).
3. **Parity testing targets Bernard Cup and Viva Italia from recent seasons only.**
   Neither the Gianotti era nor the McKinney raw-time cup validates the handicap engine.
4. **Class-code parsing must be era-aware** (2010 cutover) for the career browser.

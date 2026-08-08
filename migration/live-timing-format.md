# live-timing.com data format

Notes from reverse-engineering how live-timing serves race results, so preliminary
results can be imported **directly** rather than copy-pasted.

## The problem with pasting

`race2.php?r=<id>` renders results in JavaScript — the HTML itself contains no
results at all. That is why the existing approach copies text out of the rendered
page in landscape mode (portrait drops the Open-class column), and why the paste
parser has to reassemble rows from loose lines.

## The data endpoint

The page fetches its data from:

```
https://www.live-timing.com/includes/aj_race.php?r=<raceID>
```

It returns a flat, pipe-delimited text record — not JSON. Example (one racer):

```
b=152|m=Gunn, Robert|ms=774548379.80929|t=FW|c=B|s=M8|un=F7267740|up=0|fp=0|
r1=1:26.44=86440|r2=1:18.13=78130|tt=2:44.57|i11=28.30=2830|i21=23.69=2369|ltID=35181
```

### Field reference

| Key | Meaning | Notes |
|---|---|---|
| `b` | Bib number | |
| `m` | Name | `Lastname, Firstname` |
| **`t`** | **Open Class flag OR division** | `OP` = Open Class (Far West races). Otherwise a division: `FW`, `EA`, `RM`, `IM`, `PN`, `CN`. **See trap 1.** |
| `c` | Race group | `A` / `B` |
| `s` | Age class | `M8`, `M3`, `W6` … |
| **`un`** | **US Ski & Snowboard member number** | e.g. `F7267740` — see below |
| `r1`, `r2` | Run times | `display=milliseconds`, e.g. `1:26.44=86440`. A single-run race still emits `r2`, filled with DNS — **see trap 2.** |
| `tt` | Total time | **unreliable — recompute from the runs. See traps 3 and 4.** |
| `i11`, `i21` | Intermediate splits | run 1 / run 2; second value is centiseconds, not ms |
| `ltID` | live-timing member id | |

Header fields precede the racers: `hN` name, `hT` discipline, `hR` venue, `hST`
start time, `hID` race id, `hM` notes (e.g. "NO DSQs RUN 2").

Non-starters are encoded as `r1=DNS=2147483607` (a sentinel, `INT_MAX - 40`), which
sorts them last.

## Two things this changes

**1. Member numbers solve identity matching.** `un=` carries the US Ski & Snowboard
number, which is a stable key. Matching preliminary results to people no longer has
to rely on name spelling — the fragility that makes the current cup calculation drop
racers with nicknames or hyphenated names.

**2. No more paste step.** Given a race id, results can be fetched directly. Store it
as `races.live_timing_id` when scheduling the race; import then becomes one click,
with no landscape-mode caveat and no row-reassembly guesswork.

Keep the paste parser as a fallback — this is an undocumented internal endpoint and
could change without warning.

## Verified against official results

Live-timing race **306870** ("BERNARD CUP MASTERS GS1", Palisades Tahoe, 7 Mar 2026)
was compared against the official ACE results for the same race
(`20260307-Palisades-GS-BernardCup-1of2-ByClass.html`):

| | Count |
|---|---|
| Racers in live-timing (preliminary) | 76 |
| Racers in official ACE results | 73 |
| Matched by name | 72 |
| **Total times that differ** | **0** |

The four unmatched entries account for the whole gap:

- **3 DNS racers** (`Shklovski, Gregory`, `Poirier, Ian`, `Walker, Daniel`) — on the
  start list, dropped from official results
- **1 name-formatting variant** — live-timing has `Hlubucek , Mark` with a stray
  space before the comma; official has `Hlubucek, Mark`

So a preliminary-to-official diff should routinely expect exactly two kinds of
change: **non-starters disappearing**, and **name normalization**. Anything else is
worth a second look.

That stray space is also the argument for identity matching on the USSA number
rather than the name — it would silently create a duplicate person otherwise. In
this race **76 of 76 racers carried a `un=` value**, so the exact key is available
for everyone.

## Combined-gender: one race id per FWM race

Regular Far West division races put both genders in a single live-timing race —
306870 contains 68 men and 8 women, classes F1-F10 and M1-M13. One
`races.live_timing_id` per race is therefore correct.

**Nationals is the exception.** Only national championship races are split by
gender: live-timing 308442 ("MASTERS ALPINE NATIONALS GS A/B", 26 Mar 2026) holds
53 racers, all men. Handle Nationals as a special case rather than letting it shape
the normal schema.

## The race id is live-timing's own, not a US Ski & Snowboard code

Worth stating because it looks like it should be otherwise: the two identifiers for
the same race are unrelated.

| Source | Identifier for the 26 Mar 2026 Men's GS |
|---|---|
| live-timing | `308442` |
| US Ski & Snowboard | `M0074` |

USSA codes are `M####`, assigned per season and split by gender. Live-timing ids are
a single sequential counter across every FIS / USSA / NASTAR / USCSA event it hosts
nationwide. There is no derivable mapping, so live-timing ids cannot be produced from
the USSA schedule that is set up in the fall — they have to be captured per race.

The USSA schedule is still worth having for two other reasons: it gives dates,
disciplines and genders in advance, and it records **cancellations** (e.g. `M0071`
Super G, Canceled), which matter because best-N counts races actually scored.

## Parsing traps

Every one of these was found the hard way, by comparing against 18 seasons of
official results. Each produced a plausible-looking but wrong answer, and none of
them throws an error — they just quietly give you the wrong number.

### 1. Open Class is in `t`, not in the class field

`t` is the team/division field and it is overloaded. In Far West races it carries
`OP` for an Open Class entry; at national events it carries division codes (`FW`,
`EA`, `RM`). The racer's age class stays populated in `s` either way.

Read only `s` and roughly **a third of the field** is silently mis-classified,
because Open Class is popular — 36% of 2026 official records were Open Class.

```
b=15|m=Papazian, Ara|t=OP|s=M7|...     <- Open Class, not M7
```

### 2. Single-run races still emit `r2`, filled with DNS

Super-G and downhill have one run, but the payload still contains an `r2` field
with the DNS sentinel for every racer. It is a placeholder for a run that does not
exist, **not** a non-finish.

The only reliable way to tell a genuine DNS from "this race had one run" is whether
*any* racer in the field posted a real second-run time.

### 3. `tt` shows a time even when a run was disqualified

```
r1=42.93   r2=DQg23   tt=42.93
```

The racer was disqualified, but `tt` holds their run-1 time, which reads as a
finish. Judge whether someone finished from the **individual runs**, never from
`tt` — otherwise overturned or newly-applied disqualifications get reported as
ordinary time corrections, which is the single most interesting thing a
preliminary-to-official diff can show.

### 4. `tt` is sometimes only run 1, even when both runs completed

```
r1=49.53   r2=51.23   tt=49.53      official total: 1:40.76
```

`tt` is simply not dependable. **Always recompute the total from the runs.** The
original FWM paste parser already did this ("Total — consume if present, we
recalculate from runs"); the same caution applies to the data endpoint.

### 5. Preliminary data can be incomplete

Sometimes only run 1 was ever uploaded, while the official results carry a full
two-run total (race 292833, `FAR WEST MASTERS DP SL - SL3`). Occasionally a run
time is simply wrong — one racer shows `r1=40.85  r2=2.64`, and a 2.64-second
slalom run did not happen.

**Detect and refuse rather than publish.** If the official race has two runs and
live-timing only has one, that is half a race — announcing from it would be worse
than announcing nothing.

### 6. Names carry formatting noise

`Hlubucek , Mark` — a stray space before the comma — is the same person as
`Hlubucek, Mark`. Normalize whitespace and case before matching, and prefer the
USSA number in `un` where it exists (it was present for 76 of 76 racers in the
race checked).

## Precision: hundredths only

`r1=1:26.44=86440` looks like millisecond precision, but every millisecond value
observed ends in `0` — they are hundredths multiplied by ten. Live-timing carries no
sub-hundredth precision.

This confirms the operational reality: **live-timing is the preliminary source, and
the ski area's timing file (what ACE consumes) is the official one.** Preliminary
race points computed from live-timing can therefore differ from official ones by
0.01 at rounding boundaries — see [`scoring-history.md`](scoring-history.md). That is expected and should
be stated on preliminary results, alongside the existing Open-class disclaimer.

## Finding race ids automatically: the daily index

Race ids do not have to be collected by hand. Live-timing publishes a **static
text file per day** listing every race it hosted that day:

```
https://www.live-timing.com/dailyRaces/<year>/races_<YYYY-MM-DD>.txt
```

No JavaScript, no session, no scraping of a rendered page — it is a plain file in
the same pipe-delimited format as the race payload, with records separated by `~`.
Each record carries `hID` (the race id) plus `hR` (venue), `hST` (start time),
`hN` (race name) and `hT` (discipline).

This was found by watching what `races.php` fetches; the page itself is
JavaScript-rendered, which is why the file is not obvious from the HTML.

**Isolating FWM races.** For 2026-03-07 the file lists 142 races nationwide.
Filtering on a Far West venue plus `Masters` in the discipline field reduces that
to exactly the right race:

```
id=306870  3/7/2026 10:00 AM  PALISADES TAHOE  BERNARD CUP MASTERS GS1  Giant Slalom=Masters
```

Venues to match: Palisades Tahoe (Squaw Valley before 2021-22), Mammoth Mountain,
Sugar Bowl, Northstar, Diamond Peak, Alpine Meadows, Heavenly, Mt. Rose.

**What this makes possible:**

1. **Historical ids are recoverable in bulk** — one fetch per race *date* (not per
   race), which is roughly 100-150 requests for the whole archive. That unlocks
   comparing preliminary live-timing data against official ACE results across many
   seasons rather than one race at a time.
2. **Future races can be looked up rather than typed** — given a scheduled date and
   venue, the id can be suggested automatically, with the admin confirming rather
   than transcribing.

Fetch politely: one request per date, cached to disk, never in a loop.

## Workflow: enter the link in advance, import in one tap

FWM receives live-timing links ahead of each race, so the id is captured during
schedule setup rather than on race day.

**In advance (admin, at a desk):**

1. Paste the live-timing link or id into the race in the schedule. The field should
   accept a full URL (`.../race2.php?r=306870`) and pull the id out, so it is a
   paste rather than a transcription.
2. **Validate it immediately.** Fetch the header and show what that id actually is —
   `BERNARD CUP MASTERS GS1 · Palisades Tahoe · 3/7/2026` — next to the scheduled
   race for confirmation. A wrong link found in October is a non-event; the same
   mistake found on race day, by someone else, is a scramble.

**On race day (any results processor, on a phone):**

1. Pick the race from a dropdown.
2. Tap import. The id is already there.

No typing, no link hunting, no landscape-mode instructions — which matters because
race-day processing is done by whichever officer is present, not necessarily the
person who set up the season.

**Fallbacks, in order:** if the stored id is missing or wrong, allow pasting a link
on the import screen; if live-timing itself is unreachable, fall back to the text
paste parser. The venue is the worst possible place to be blocked.

## Etiquette

This is a small operator's undocumented endpoint. Fetch once per race, cache the raw
payload (`race_imports.raw_payload` exists for this), and never poll in a loop.

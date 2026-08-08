# Migration tooling and reference documentation

Two things live here: the scripts that move FWM off Airtable and gather the evidence
the new system is checked against, and the written record of FWM's scoring rules.

## The documentation

Read in this order if you are new to the results side:

| Document | What it covers |
|---|---|
| [scoring-history.md](scoring-history.md) | **Start here.** Every scoring rule and how it changed since 2009. Opens with why a recomputed value can differ from the official one by 0.01 — the first question anyone auditing this work will ask. |
| [cup-rules.md](cup-rules.md) | The three cups, which are *not* scored alike: Bernard Cup, Viva Italia, and the McKinney Cup / Silver Dollar Derby. |
| [live-timing-format.md](live-timing-format.md) | How to import preliminary results from live-timing.com, including six parsing traps that fail silently. |
| [schema-design.md](schema-design.md) | The database design and the reasoning behind it, plus the open questions. |
| [sms-limits.md](sms-limits.md) | SMS segments, the GSM-7 vs UCS-2 cliff, and FWM's real character budget. Read before touching the compose screen. |

Everything in them was **measured from FWM's own published results**, not recalled.
Each measurement is reproducible with the scripts below.

## The scripts

Run from the repository root.

### `airtable-backup.mjs` — snapshot both Airtable bases

Dumps every table to JSON (authoritative) and CSV (convenience). Output goes
**outside this repo**, to `../fwm-migration-backups/<timestamp>/`, because member
records contain phone numbers and email addresses and this repo is public.

One-time setup: create a **read-only** Airtable token at
https://airtable.com/create/tokens with scopes `data.records:read` and
`schema.bases:read`, granted to both bases.

```bash
export AIRTABLE_PAT="pat_xxx"     # do not put this in a file
node migration/airtable-backup.mjs
```

Each run writes a fresh timestamped snapshot. Override the location with
`FWM_BACKUP_DIR`.

| Base | ID | Purpose |
|---|---|---|
| Texting | `appdtnCaTqTFwrR3s` | FWM members + SMS console (still in use) |
| Results | `appcFgDVZaMhlFhYN` | Race results, standings, cups |

### `archive-results.mjs` — mirror the published results

Downloads every race result, cup result and season standings page that ACE Scoring
has published to classic.farwestmasters.org, back to the 2009 season. This mirror is
the answer key the scoring engine is verified against, and doubles as a backup of 18
years of club history that currently exists in one place.

```bash
node migration/archive-results.mjs            # last three seasons
node migration/archive-results.mjs --all      # everything, 2009 onward
```

Polite by construction: one request per second, a descriptive user-agent, and
already-downloaded files are skipped, so re-running is nearly free.

### `harvest-live-timing-ids.mjs` — recover live-timing race ids

Live-timing publishes a static text file per day listing every race it hosted, which
means race ids can be found automatically rather than collected by hand. This matches
each archived FWM race to its live-timing id by date, venue and discipline.

```bash
node migration/harvest-live-timing-ids.mjs                 # 2019 onward
node migration/harvest-live-timing-ids.mjs --all
```

Writes `../fwm-results-archive/live-timing-ids.json`, recording *how* each id was
matched. Ambiguous cases are reported rather than guessed — a wrong id silently
compares the wrong race, which is worse than reporting nothing.

### `detect-points-scale.mjs` — derive the class-points scale per season

Reads the `points (rank)` pairs printed in each season's published standings and
reports the scale that was actually in force, and where it changed. This is how the
2016 changeover was established rather than assumed.

```bash
node migration/detect-points-scale.mjs
```

## Schema files

`schema.sql` is the readable, commented reference copy of the database design.
The migrations actually applied to Supabase live in `../supabase/migrations/`, and
the two are kept in step.

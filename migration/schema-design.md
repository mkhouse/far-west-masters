# FWM platform — shared database design

One Postgres (Supabase) database serving **both** apps: member texting and race
results/standings. Draft for review — see **Open questions** at the bottom.

## The five decisions that matter

### 1. One `people` table, not "members" + "racers"

Today, member data lives in the texting base and gets hand-copied into the results
base via the `Sync from member list for YOB` table (the cup handicap needs birth
year and gender). That sync disappears entirely: one row per human, used by both apps.

Non-FWM racers appear in FWM results too, so `people` holds them as well —
`status = 'non_member'`, no contact info. A person needs a phone and consent to be
texted; they need a birth year and gender to be scored in a cup. Same table, different
columns populated.

### 2. One `races` table, shared by both apps

Both bases keep their own race list today. They're the same races — texting notifies
the people registered for a race; results scores that same race. One list, one place
to fix a typo.

Registration (from AdminSkiRacing) is `race_entries`. Actual results are `results`.
Different things: you can register and not start, or race without appearing in our
registration import.

### 3. Results are rows, not columns

This is the fix for the Airtable pain. Today each race is its **own table** (~20 of
them), and the standings table carries a link + lookup + rollup field per race —
which is why starting a season means hand-rebuilding dozens of fields, and why the
README's season-setup instructions are 6 manual steps.

Here, a new race is one `INSERT`. Standings are computed, not hand-wired formulas.

### 4. Raw import payloads are stored forever

`race_imports` keeps the exact text pasted from live-timing (or the uploaded ACE
HTML) alongside the parser's output and the parser version.

This matters specifically for the parity project: when we find a parser edge case,
we can **re-run the engine over every historical import** and see what changes, without
re-collecting anything. It's also the audit trail for "why does this race look like that?"

### 5. Scoring math lives in TypeScript only — never duplicated in SQL

Race points, class points, best-N selection, and cup handicaps are computed by the
engine (ported from `airtable-results/*.js`, alongside the validated `parseResults.ts`)
and the *results* are stored. No scoring formula gets reimplemented as a database
view or generated column.

Two implementations of the same rule drift, and drift is exactly what breaks a
parity claim. One implementation, fully unit-tested against published results.

## Security: member contact data must never leak

The public results pages and the private member data share a database, so this is
worth being explicit about.

Supabase exposes an auto-generated REST API to the browser using a **public** anon key.
So the design is:

- **RLS enabled on every table, default deny.** The anon key can read nothing.
- **Public results pages are rendered server-side / statically at publish time** using
  the service-role key, which never reaches the browser.
- Officer tools authenticate via magic link; access is checked in server routes
  against `app_users.role`.

Net effect: there is no path from a public page to a phone number, even if someone
finds the anon key (they will — it ships in the JS bundle).

## Tables

| Table | Purpose | Used by |
|---|---|---|
| `people` | every human: members + non-member racers | both |
| `person_aliases` | name variants for matching imports | both |
| `app_users` | login → role (admin / processor) | both |
| `seasons` | season config incl. best-N | results |
| `races` | one row per race, shared | both |
| `race_entries` | who registered (AdminSkiRacing import) | texting |
| `race_imports` | raw payload + parsed snapshot per import | results |
| `results` | one row per competitor per race | results |
| `standings` / `standing_entries` | computed season standings | results |
| `cups` / `cup_races` / `cup_results` | Bernard Cup et al. | results |
| `messages` / `message_recipients` | outbound SMS + per-person delivery log | texting |
| `inbound_messages` | replies, STOP handling, forwarding | texting |

### Name matching

`cup-results-calc.js` currently matches a racer to their birth year by checking that
the member's `Results name` *contains* both the lowercased first and last name. A
nickname or a hyphenated name silently drops that racer from cup results.

Replacement, in priority order:

1. **USSSA number** where the source provides it (AdminSkiRacing does)
2. **Exact normalized alias** in `person_aliases` (`lastname, firstname`, case/accent-folded)
3. Fuzzy suggestion → **queued for a human to confirm**, never auto-matched silently

Unmatched results still import — `results.person_id` is nullable. A racer with no
match still gets scored in their race; they just don't link to a person record until
someone resolves it. Nothing is silently dropped.

## Career results (public racer history)

The published archive at `classic.farwestmasters.org` goes back to **2009-10**, and
`archive-results.mjs` mirrors all of it. That turns the archive from a test fixture
into actual product data: a public page where a racer can see every FWM result
they've ever had, season by season.

Nothing in the schema changes to support this — `seasons` simply gets 17 rows instead
of one, and a career view is a query across `results → races → seasons` for a person.
Three things do need attention:

**Identity across 17 seasons is the hard part.** The ACE files carry names only —
no USSSA number, no birth year. So "Smith, Don" in 2011 and "Smith, Don" in 2026 are
*probably* the same person, and two different "J. Anderson"s might not be. The plan:
match conservatively, leave `results.person_id` null when unsure, and provide an
admin merge screen. A wrong merge is worse than an unmatched result, so the default
is to under-match and let a human confirm.

**Historical rules differ.** Best-N, the points scale, and class definitions have
almost certainly changed since 2009. Per-season config already lives on `seasons`,
but we should *display* archived standings as published rather than recomputing them
under today's rules. Recomputation is for parity checking on recent seasons, where we
know the rules.

**Publishing a searchable 17-year profile is a step beyond publishing a race result.**
Every individual result is already public, but aggregating them into a per-person
page is different in kind. Worth a simple opt-out (`people.hide_public_profile`) so
anyone who asks not to appear can be honored without a code change.

## Cross-app features (the reason to unify)

These only work because membership and results finally share a database. Neither
Airtable base could produce them alone.

**Lapsed-racer detection.** Members who raced in prior seasons but not this one, and
members who have never raced. Results data identifies them; the texting app reaches
them. For context: the 2026 standings list **125 competitors against 309 members** —
a gap nobody can currently see, let alone act on. The Fall 2025 questionnaire already
asks "if you did not race or volunteer, why," so the concern is established; the data
to answer it just lived in the wrong place.

**Award eligibility.** `seasons.min_starts_for_award` (6 by default) against each
racer's `starts`. The valuable part is mid-season: flagging who is one or two starts
short while they can still do something about it, which is directly actionable as a
text. The 70+/exceptional waiver becomes an admin override rather than someone's
memory.

**Racer progression.** On career pages: personal bests by discipline, results over
time, comparison to class average. Each season rendered under its own historical
rules — see `seasons.points_scale` and `seasons.age_groups`.

**Publishing automation.** The results index and season schedule in `html-templates/`
are currently hand-edited after every race weekend and pasted into Squarespace, and
race recaps are hand-built for the Forerunner. All of that content is in the database
the moment a race is published, so it can be generated instead — emitting the same
markup the existing `squarespace-custom.css` expects, and the same Outlook-safe
table/inline-CSS structure the email templates use.

## Known gap: 2002-2008

The archives page lists 2002-2008 as "temporarily unavailable while portions of the
web site are reworked," so those seasons are not in the mirror. Recovering them
depends on people who know where the files went, which makes it a relationship
question rather than a technical one. Worth revisiting once the project has buy-in
from the current results maintainer.

## Verification is a workflow step, not a one-off study

Publishing official results must include an automatic comparison against the
preliminary live-timing import for the same race, reviewed by the processor before
anything goes live.

This is deliberately not just a research exercise. The same comparison that tells us
*historically* how often preliminary and official differ should run on *every* race
going forward, for three reasons:

1. **It catches import mistakes.** The most likely error is not a subtle scoring bug
   — it is importing the wrong race, or importing a file twice. A diff that suddenly
   reports 60 changed racers makes that obvious immediately; without it, a wrong
   import looks exactly like a successful one.
2. **It makes the Open-class limitation visible.** Live-timing cannot know about an
   Open class election made after the start list closed. Those changes should be
   surfaced and confirmed rather than silently applied.
3. **It builds a record.** Storing each diff alongside the import means "why did this
   result change?" is answerable months later, which is the question that erodes
   trust in a results system when nobody can answer it.

**What to store:** the diff itself, attached to the official import, categorised as
racers removed (distinguishing did-not-start from genuine removal), racers added,
class changes, time corrections, and status changes.

**What to flag:** anything outside the pattern the historical comparison establishes.
Non-starters disappearing is routine and can be summarised in a line. A time
correction or an unexplained removal deserves the processor's attention.

The comparison logic lives in `results-engine/bin/prelim-parity.ts` and should be
reused by the app rather than reimplemented — the same rule as the scoring engine:
one implementation, or the two drift apart.

## Manual overrides on preliminary results

A referee can overturn a disqualification at the venue, well before the ski area's
timing file reaches the scorer. Results are announced from that corrected picture,
so the app has to allow a processor to overturn (or apply) a DQ on preliminary
results — otherwise the announced result and the displayed result disagree, in
front of the racers.

The comparison against historical official results shows this is not hypothetical:
DQ status is one of the categories that genuinely changes between preliminary and
official.

**Design constraints, in priority order:**

1. **Never edit the import.** `race_imports.raw_payload` is the evidence of what
   live-timing actually said. Overrides live in a separate table and are applied on
   top when results are computed, so re-importing preliminary data cannot silently
   discard a correction — and a correction cannot silently rewrite history.
2. **Record who, when and why.** "Referee overturned gate judge call, run 2" is the
   difference between a defensible result and an unexplained one months later.
3. **Show that it was overridden.** Anywhere an adjusted result is displayed or
   announced, it should say so. Quietly corrected data is how a results system
   loses trust.
4. **Reconcile against official.** When the official file arrives, each override is
   compared with it, so the processor sees whether the official scoring agreed. An
   override the official file contradicts is exactly the thing worth knowing about.

Scope: run status (DSQ or DNF to a time, or a time to DSQ/DNF), because that is
what referees actually change. Not raw times — those come from the timing system,
and an app is not the place to retype them.

## Questions since answered

Kept because the answers are load-bearing, and because someone will ask again.

1. **Best-N rule** — `ceil(0.75 × races scored)`, matching the published rule
   ("your best results in 75% of the races, rounded up"). Based on races actually
   scored, not scheduled, which is why 2026 is best 11 of 14 despite being announced
   as best 12 of 16. The one exception is the covid-shortened 2021 season, where all
   six races counted. Reproduces every racer's published total across 18 seasons.
   Starts and finishes follow the rule documented in the Airtable base: a start is
   any entry that is not DNS; a finish is a scored result with no D status.
2. **Class 14 (ages 90+)** — defined in the cup code, but **no class 14 appears
   anywhere in the archive**. Its handicap extrapolation is untested and also
   unexercised. Left as is. (See [cup-rules.md](cup-rules.md).)
3. **Open-class mid-season election** — the racer is scored in Open, and their age
   class row remains only as a starred stub carrying no points. Confirmed in the 2009
   standings, where Belden, Kurt appears twice: `1 | Belden, Kurt (M50) | 295 | 17* | 16`
   in the open group, and `49(t) | Belden, Kurt | - | 1* | 0*` in his age class.
4. **Race points source** — the engine recomputes from times rather than trusting a
   stored value, and agrees with the published results for 99.8% of 14,988 checks.
   Every difference is exactly 0.01 and explained
   ([scoring-history.md](scoring-history.md)).

5. **Membership is per season, but is not modelled — deliberately.** FWM membership
   is conceptually per season, and the published award rule requires entrants to be
   "current paid members ... for the current season".

   The membership director verifies membership at registration, so **anyone who
   appears in a race is a member for that season**. There is nothing for this system
   to validate, and award eligibility reduces to the starts count. Building a
   membership table now would mean an empty table with no data source.

   If membership tracking is added later it belongs in a `memberships` table
   (person, season, paid) rather than a flag on `people` — a racer can lapse and
   rejoin, and lapsed-racer outreach needs to know *when* someone stopped renewing,
   not merely that they have.

   `people.status` remains the operational category used for messaging — officer,
   out-of-region racer, imported-from-registration — and is **not** a membership
   record.

6. **Nationals do not count toward FWM season standings** — confirmed. Nationals is
   on the schedule and members are texted about it, but it is scored and published by
   usalpinemasters.org. Modelled as `races.counts_toward_standings`.

   This is not cosmetic: best-N counts races actually scored, so including Nationals
   would change every racer's season total.

## Still open

1. **Recovering the 2002-2008 seasons.** Listed as temporarily unavailable on the
   archive index, so not mirrored. A relationship question rather than a technical
   one.

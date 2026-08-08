# FWM platform runbook

Operating instructions for the Far West Masters texting and results system.

**Who this is for:** whoever is running the system — not necessarily whoever built
it. If you have inherited this and nobody handed you context, start here.

The whole point of this system is that it should not depend on one person. If you
find something here that is wrong, out of date, or that you had to work out for
yourself, fix it in this file. That is not overhead; it is the job.

---

## What this is

Two things sharing one database:

- **Texting** — sends SMS to members via Twilio, with a consent rule that some
  members cannot receive bulk messages until an intro text has gone out.
- **Results** — imports race results, computes class ranks, race points, season
  standings and cup results, and publishes them.

Race scoring is not improvised: the engine reproduces every result FWM has published
since 2009, verified against the club's own archive. If a number looks wrong, that
history is the first place to check — see
[migration/scoring-history.md](migration/scoring-history.md).

## Accounts and access

| Service | What it holds | Who has access |
|---|---|---|
| Supabase | The database — members, results, messages | **TODO: list owners** |
| Twilio | The SMS number and A2P registration | **TODO** |
| Vercel | Hosting | **TODO** |
| GitHub | The code | github.com/mkhouse/far-west-masters |

> **Action outstanding:** each of these should have **at least two owners**, or be
> held on a club-owned email rather than a personal one. A system that only one
> person can log into has the same problem this project exists to solve.

### Officer accounts in the app

Signing in and being allowed in are separate. Anyone can request a magic link;
access requires a row in the `app_users` table, which only an admin can create.

Roles: `admin` (season setup, schedule, user management) and `processor` (import
results, send messages).

## Regular operations

### Before the season

1. Create the season with its scoring rules (best-N, points scale, age groups).
2. Enter the race schedule.
3. For each race, add the **live-timing race id**. Links arrive by the Monday before
   a race at the latest, and the system can look the id up from the date and venue —
   confirm the suggestion rather than typing it.
4. Mark any race that does **not** count toward standings — Nationals in particular,
   which is scored and published by usalpinemasters.org.

### Race day

1. Pick the race from the list and import the preliminary results from live-timing.
2. Review the parse before publishing.
3. Publish as **preliminary**. Roughly 85% of racers come through unchanged; what
   moves is mostly the entry list, so the banner should say *who raced may still
   change* rather than casting doubt on the times.
4. If a referee overturns a disqualification before the official file arrives, apply
   the override in the app so what is announced matches what is displayed.

**Do not publish a race where live-timing only has run 1** of a two-run race. That is
half a race. The importer should refuse; if it does not, stop and fix that.

### When the official file arrives

1. Import it as **official**.
2. **Review the diff against the preliminary import.** Non-starters disappearing is
   routine. A time correction, an unexplained removal, or a class change deserves a
   look before publishing.
3. Publish. Standings recalculate.

### Sending a text

1. Choose the audience — a race, a series, or all members.
2. Write the message. Watch the segment counter: over 160 characters costs multiple
   segments per recipient.
3. The system excludes anyone who has opted out, is suppressed, or has not been sent
   an intro text. **This is FWM's own consent rule, not a technical limit.** If the
   recipient count looks low, that is usually why.
4. Check the **What arrives on the phone** preview. It shows the message as members
   will see it, with everything the system adds greyed out.
5. Send. Replies are forwarded to the membership director's phone; STOP is handled
   automatically.

**`Text STOP to stop` is added by this app**, not by Twilio, and it costs 18 of the
160 characters in a segment. To change the wording, edit `sms_optout_text` in
`app_settings` — the character budget follows automatically. Set it to an empty
string *only* if Twilio is ever configured to append its own, or members will get it
twice.

### The send log

`/messages` is the record of every text the system has sent: what was sent, to which
audience, **by which officer**, and what reached a phone. Open a message to see the
per-recipient delivery state and any failures.

Two things about it are deliberate:

- **Delivery lags sending.** Twilio accepting a message is not the same as a carrier
  delivering it. A send can read as `queued` for minutes and still arrive. Counts
  update as the status webhook reports back.
- **Attribution is stored, not looked up.** The sender's name is written onto the
  message when it is sent, so the log still answers "who sent this" even if that
  person's contact details are later removed from the member list.

If someone asks why they received a text, this page — plus the audience label on the
message — is the answer.

## When something breaks

**Start here — it distinguishes the three usual causes:**

```bash
node web/scripts/check-db.mjs
```

It reports whether credentials work, whether the migrations landed, and — the check
worth having — whether the browser-facing key can read member phone numbers. It
should always say `NO — correct`.

| Symptom | Likely cause |
|---|---|
| `permission denied for table …` | `service_role` grants missing — run migration 0004 |
| Sign-in emails never arrive | Supabase's built-in mailer is rate limited to a few per hour; custom SMTP must be configured |
| "Not authorized" after signing in | No `app_users` row for that account |
| Results import produces nonsense | Check the live-timing parsing traps in [migration/live-timing-format.md](migration/live-timing-format.md) — six of them fail silently |
| A score is off by 0.01 | Expected, and explained — see "READ FIRST" in [migration/scoring-history.md](migration/scoring-history.md) |

## Backups

| What | Where | How |
|---|---|---|
| Database | Supabase daily backups (**Pro plan only**) | Automatic |
| Airtable (historical) | `../fwm-migration-backups/` | `node migration/airtable-backup.mjs` |
| Published results archive | `../fwm-results-archive/` | `node migration/archive-results.mjs --all` |

The results archive is worth keeping. It mirrors 18 years of published club history
that otherwise exists in one place, on ageing infrastructure.

> **Note:** the free Supabase plan has **no backups** and pauses a project after a
> week of inactivity. Upgrade to Pro before relying on this system for a season.

## Maintenance

Rarely needed, but this is what it looks like:

- **Verify the scoring still agrees with history** — `npm run parity`,
  `npm run standings`, `npm run cups` in `results-engine/`. Run these after any change
  to scoring code. They compare against every published FWM result since 2009.
- **Dependency updates** — occasional. Nothing here changes fast.
- **Rotating a key** — replace it in the Supabase/Twilio dashboard, update
  `web/.env.local` locally and the environment variables in Vercel.

## If you are handing this over

Work through this list with the person taking over:

1. Add them as an owner on Supabase, Twilio, Vercel and GitHub.
2. Give them an `admin` role in `app_users`.
3. Walk through one real race import and one real message send together.
4. Show them this file, and the "READ FIRST" section of `scoring-history.md`.
5. Make sure they know they can change this document.

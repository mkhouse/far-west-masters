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
| Vercel | Hosting — team "Far West Masters", project `far-west-masters-web` | **TODO** |
| GitHub | The code | github.com/mkhouse/far-west-masters |

> **Action outstanding:** each of these should have **at least two owners**, or be
> held on a club-owned email rather than a personal one. A system that only one
> person can log into has the same problem this project exists to solve.

### Officer accounts in the app

Signing in and being allowed in are separate. Anyone can request a magic link;
access requires a row in the `app_users` table, which only an admin can create.

Roles: `admin` (season setup, schedule, user management) and `processor` (import
results, send messages). Give `processor` unless someone genuinely needs to manage
other people's access.

**To add an officer:** edit the email, role and note at the top of
`supabase/invite-officer.sql`, run it in the Supabase SQL editor, and tell them to
sign in at `/sign-in`. Their access is created automatically the first time they do.
You do not need to be available when it happens, and they never see a refusal.

This works in either order — someone who has already signed in and bounced off "Not
authorized" gets access on their next page load.

**An outstanding invitation is a standing grant to whoever controls that mailbox.**
That is already true of magic-link sign-in, but an invitation makes it a decision
taken in advance, so revoke ones you no longer want: delete the row while
`claimed_at` is null. Once claimed, deleting the invitation achieves nothing —
remove their `app_users` row instead.

If someone reports "Not authorized" despite being invited, they almost certainly
signed in with a different address than the one you invited. A magic link requested
with a different email creates a different account entirely. Both queries at the end
of the invite script will show it: they will appear in neither list.

`supabase/grant-officer.sql` does the same job directly, for someone who has already
signed in. Prefer the invitation.

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
3. The system excludes anyone who has opted out, is suppressed, has not opted in, or
   has not been sent an intro text. **This is FWM's own consent rule, not a technical
   limit.** If the recipient count looks low, that is usually why.

   **Consent has two halves**, and both are required: the member submits the opt-in
   form (`opt_in_at`), and FWM sends them an intro text confirming it
   (`intro_sent_at`). Nothing in this system messages anyone who has not opted in —
   there is no override, for any audience, including test groups.

   The **"Opted in, awaiting their intro text"** audience is how the second half gets
   done. It reaches members who submitted the form but have not been introduced yet;
   sending it stamps `intro_sent_at` and moves them into the regular audiences. That
   is the only audience where consent is not already complete, and it is not an
   exception to the rule — those people asked to hear from the club.

   Note the order: **form first, then intro text.** Texting people to ask them to opt
   in would contradict the consent process described to Twilio when the toll-free
   number was verified.
4. Check the **What arrives on the phone** preview. It shows the message as members
   will see it, with everything the system adds greyed out.
5. Send. Replies are forwarded to the membership director's phone; STOP is handled
   automatically.

**A send takes minutes, and that is normal.** One phone number emits roughly one
message per second, so ninety members takes a couple of minutes. The button is
replaced by a spinner for the whole time. Do not reload the page to check — the
send is running, and the message page will show every recipient when it finishes.

Sending the same words to the same audience twice within ten minutes is refused,
on the assumption it was an accident. If you genuinely mean to repeat a message,
wait, or change the wording.

**`Text STOP to stop` is added by this app**, not by Twilio, and it costs 18 of the
160 characters in a segment. To change the wording, edit `sms_optout_text` in
`app_settings` — the character budget follows automatically. Set it to an empty
string *only* if Twilio is ever configured to append its own, or members will get it
twice.

### When a member replies

The reply is forwarded to whichever officer was named on that message, as:

```
From Damian Palfini +15305550142 (re: Sugar Bowl start times): See you at 9
```

**Do not reply to that text.** It arrives from the FWM number, so a reply goes back
into the system, not to the member. Twilio will only send from numbers the club
owns, so a forward can never appear to come from the member's phone — that would be
spoofing, and carriers block it.

To answer, **copy the number and start a normal conversation.** Two things follow
from that, and both are worth knowing before you do it:

- Nothing after that point is recorded here. The send log will show what the club
  sent and what the member replied, but not your answer.
- The member ends up holding your personal number.

A reply inbox inside the app would fix both, and is the intended answer when replies
become common enough to be a nuisance.

### Looking someone up

`/members` answers "is this person in the system, and why aren't they getting
texts?" Search by name, phone or email — phone matching ignores punctuation, so
`(530) 555-1234` and `5305551234` both find the same person.

The filters along the top are the consent states, with counts: **can receive
texts**, **awaiting intro**, **not opted in**, **opted out**, **suppressed**, **no
phone**. Those six are exhaustive — everyone is in exactly one — so the counts are
the fastest picture of where the club stands.

Open a member to see the dates behind that state, which groups they are in, every
message they have been sent with its delivery result, and anything they have texted
back.

**Read-only for now.** Corrections to a member record still need SQL. Editing
arrives with the opt-in review queue, along with the audit trail those fields need.

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

## Deployment

The app is hosted on Vercel at **https://fwm-results.mkinthehouse.com**, built from
the `main` branch of this repository. Pushing to `main` deploys. There is no
separate release step. The original `far-west-masters-web.vercel.app` address still
works and is kept as a fallback.

> **That domain is a bridge, not the destination.** It belongs to Melissa
> personally, and was used because nobody yet has DNS access for
> `farwestmasters.org`. Moving the app to the club's own domain is the same
> three-step change described under "Changing the domain" below, and should happen
> once that access exists — a club system on one person's domain is the dependency
> this project exists to remove.

| Setting | Value | Why it matters |
|---|---|---|
| Root Directory | `web` | The app is one workspace in a monorepo |
| Install command | `npm install --prefix=..` | Installs from the workspace root so `@fwm/results-engine` resolves |
| Environment scope | **Production only** | See below |

### Environment variables

The eight variables are listed and explained in `web/.env.example`. Values live in
Vercel (Settings → Environment Variables) and in `web/.env.local` locally.

> **Never mark a `NEXT_PUBLIC_` variable as Sensitive in Vercel.** Sensitive values
> are withheld from the build, and `NEXT_PUBLIC_` values are compiled *into* the
> build — so the variable ends up with no value at all, and every read of it returns
> undefined. Nothing warns you. What it looks like instead: delivery reports stop
> arriving, and sign-in links point at `localhost` and fail as "expired". The three
> `NEXT_PUBLIC_` variables are public by design — they are sent to every visitor's
> browser — so there is nothing to protect.
>
> Do keep `SUPABASE_SERVICE_ROLE_KEY` and `TWILIO_AUTH_TOKEN` sensitive. They cannot
> then be read back from the dashboard, so if `.env.local` is lost, regenerate them
> from the Supabase and Twilio dashboards rather than trying to recover them.

**Scope them to Production only, never Preview.** A preview deployment is built from
any branch, including an unfinished one. Given production credentials it would hold
the real member database and be able to send real texts. Preview builds are meant to
be harmless; that is what makes them so.

### Changing the domain

Three places have to change together:

1. `NEXT_PUBLIC_SITE_URL` in Vercel — then **redeploy**, because it is baked in at
   build time
2. The Twilio inbound webhook URL
3. Supabase → Authentication → URL Configuration (Site URL and Redirect URLs)

Miss the third and sign-in breaks.

The Twilio webhooks no longer depend on `NEXT_PUBLIC_SITE_URL`: signature checks
rebuild the signed URL from the request Twilio actually made, so a wrong or stale
value there cannot silently kill replies and delivery reports. It is still worth
setting correctly — it is what tells Twilio where to send status callbacks in the
first place.

### Twilio message configuration

Phone Numbers → the FWM number → Messaging:

| Field | Value |
|---|---|
| A message comes in | Webhook, `https://fwm-results.mkinthehouse.com/api/twilio/inbound`, HTTP POST |
| Primary handler fails | Studio Flow → **Autoresponder** |

The fallback is deliberate. If the app is ever down mid-season, a member who texts
in gets the old "we cannot respond to texts" reply rather than silence.

**But know what it hides.** The webhook returns 403 when a signature check fails —
a misconfigured `NEXT_PUBLIC_SITE_URL` does exactly that — and Twilio treats 403 as
a failure and runs the fallback. From a member's phone that looks completely normal.
So if replies stop appearing in the database while members still get an
autoresponder reply, the fallback is doing its job and the app is broken. Clear the
fallback while debugging, so failures are loud.

### Rolling back

Vercel keeps every previous deployment. Deployments → find the last good one → `···`
→ **Promote to Production**. It takes seconds and needs no git operation. Roll back
first, diagnose after.

Note that a rollback does **not** undo a database migration. If a deploy went out
alongside a schema change, check whether the older code still works against the new
schema before promoting it.

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
| Delivery stuck on `queued`, never `delivered` | `NEXT_PUBLIC_SITE_URL` does not match the deployed URL, so Twilio's status callbacks are rejected with 403 |
| Replies not appearing, but members get an autoresponder reply | Same cause — the Twilio fallback is masking a failing webhook. See Deployment |
| `permission denied for table …` | `service_role` grants missing — run migration 0004 |
| Sign-in emails never arrive | Custom SMTP not enabled — the built-in mailer allows about two per hour, project-wide, and cannot be raised |
| Sign-in hangs ~30s, then "email rate limit exceeded" | The SMTP host is not answering. A web domain and its mail server are different machines: use the provider's mail host (`smtp.dreamhost.com`), not the domain itself |
| SMTP fails as though the password were wrong | Username must be the **full email address**, not the part before the @ |
| Two sign-in attempts in a row both fail | "Minimum interval per user" (Authentication → Rate Limits) is 60s, separate from the hourly cap. Wait a minute between attempts when testing |
| Edited an auth email template, but sends still use the old one | Supabase caches templates for a few minutes. The dashboard preview updates immediately, which makes it look like the change is live. Wait, then send one test — repeated attempts only burn the rate limit |
| Sign-in link says "expired" on a first click, AND delivery reports stopped | Both at once means `NEXT_PUBLIC_SITE_URL` has no value in the build — almost certainly marked Sensitive in Vercel. See Environment variables above |
| Sign-in link says "expired" on a first click | The code did not reach `/auth/callback`. Supabase falls back to the **Site URL** whenever the redirect it was asked for is not in the allow list. Check Redirect URLs contains `<site>/auth/callback` exactly |
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

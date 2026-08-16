# Screens

Next.js App Router. Every folder with a `page.tsx` is a URL; everything else is a
component or a route handler it uses.

**Start with [`../lib/audiences.ts`](../lib/audiences.ts) if you only read one file.**
That is where the consent rule lives — who a message reaches and who it does not —
and it is the piece most worth a second pair of eyes.

## The rules everything here follows

**Nothing messages anyone who has not opted in.** Consent has two halves, both
required: the member submits the opt-in form (`opt_in_at`), and the club sends them
an intro text confirming it (`intro_sent_at`). There is no override, for any
audience, including test groups. The intro-text audience is the only one that
reaches people whose consent is incomplete, and even that requires `opt_in_at` — it
is what supplies the missing half.

**The browser never decides who receives a text.** The compose screen posts an
*audience*, never a recipient list; `send.ts` re-resolves it server-side. A stale
page, an edited form, or a roster import running concurrently cannot widen who gets
messaged.

**Sending is the only irreversible action.** It is deliberately harder to do by
accident than anything else here: duplicate sends are blocked in the UI and again
on the server, the send button is replaced by a spinner while it runs, and every
send is recorded with who sent it before a single message goes out.

**Authorisation lives next to the data, not in middleware.** `proxy.ts` establishes
that someone is signed in. Whether they may *do* a thing is checked in the server
code that touches data — because a missed check there is where the harm would be.

## Layout

| Path | What it is |
|---|---|
| `layout.tsx` | Root layout; mounts the header |
| `app-header.tsx` | Top bar. Renders nothing when signed out, so public pages stay clean |
| `nav-links.tsx` | Nav with the current section underlined. A client component only because it needs the path |
| `globals.css` | Theme tokens, including the FWM navy and burgundy used across the app and the email templates |

## Messaging

| Path | What it is |
|---|---|
| `messages/page.tsx` | The send log. Every message ever sent, who sent it, what reached a phone. Searchable across the whole history |
| `messages/[id]/page.tsx` | One message: who it went to, the body as members received it, and every recipient with delivery state. Failures sort to the top |
| `messages/compose/page.tsx` | Loads audiences, officers and length limits from the database |
| `messages/compose/compose-form.tsx` | The composer. Segment counting, cost, the smart-punctuation fixer, and a preview of the message as it will arrive |
| `messages/compose/send.ts` | **The send action.** Authorise, re-resolve the audience, re-check limits, record the message, then send. Read the comment at the top before changing it |

## Members

| Path | What it is |
|---|---|
| `members/page.tsx` | Directory. Filters by membership, texting state and missing USSA number; those combine, and the filtered set can be messaged |
| `members/[id]/page.tsx` | One member: whether they can be texted and why, groups, everything sent to them, everything they replied |
| `members/copy-button.tsx` | Copies a phone number or email |
| `members/copy-emails.tsx` | Copies every email in the current filtered list |

Read-only. Editing arrives with the opt-in review queue, along with the audit trail
the consent fields need.

## Admin

| Path | What it is |
|---|---|
| `admin/page.tsx` | Index. Lists what is built and what is not, deliberately |
| `admin/groups/page.tsx` | Messaging groups — named audiences an admin maintains |
| `admin/groups/actions.ts` | Create, rename, delete, add and remove members. Every action re-checks the admin role |
| `admin/groups/member-picker.tsx` | Filter-and-tick, so adding a dozen people is one submit |

## Authentication

| Path | What it is |
|---|---|
| `sign-in/page.tsx`, `sign-in-form.tsx`, `actions.ts` | Magic-link sign-in. No passwords to manage for a handful of volunteers |
| `auth/callback/route.ts` | Exchanges the magic-link code for a session |
| `sign-out/route.ts` | POST only, so nothing else can sign an officer out on their behalf |

Signing in and being let in are separate. Anyone can request a link; access needs a
row in `app_users`, which an admin creates — or an invitation recorded in advance,
which the app converts on first sign-in.

## Webhooks

| Path | What it is |
|---|---|
| `api/twilio/inbound/route.ts` | Member replies. Records STOP and START, forwards replies to the right officer with the member's number |
| `api/twilio/status/route.ts` | Delivery reports. Twilio accepting a message is not the same as a phone receiving it |

Both verify Twilio's signature against the URL of the request itself rather than a
configured value — a wrong setting there once silently killed both, and a rejected
webhook looks exactly like Twilio never calling.

## Tests

`npm test` from the repository root. Nothing under `app/` is tested directly — the
routes here are thin, and the rules worth pinning down live in `src/lib`: the consent
gate, consent states, SMS segment counting, phone normalisation and the directory
filters. RUNBOOK.md lists what each area covers, and what is deliberately not covered.

The one thing to know while working in this directory: **the consent gate is tested,
and it should stay that way.** If you add an audience, a send path, or anything that
resolves a set of people to text, add the case to `src/lib/audiences.test.ts` that
proves it cannot reach somebody who has not opted in.

## Not built yet

`process/page.tsx` is a placeholder for race-result processing. The scoring engine
exists and is verified against every published FWM result since 2009 — see
`results-engine/` and `migration/scoring-history.md` — but nothing here uses it yet.

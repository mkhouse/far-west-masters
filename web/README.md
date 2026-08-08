# FWM platform — web app

Next.js application for Far West Masters: member texting via Twilio, race results
processing, and public results and standings.

Replaces two Airtable bases. See the [repository README](../README.md) for how this
fits with the rest, and [migration/schema-design.md](../migration/schema-design.md)
for the data model.

## Local setup

```bash
npm install                      # from the repository root — this is a workspace
cp web/.env.example web/.env.local
```

Fill in `web/.env.local`. The two `NEXT_PUBLIC_` Supabase values are public by design
(they ship in the browser); everything else is secret and must never be committed.
`.env.local` is gitignored and git will refuse to stage it.

Apply the database schema by running these in the Supabase SQL editor, in order:

```
supabase/migrations/20260806000001_initial_schema.sql
supabase/migrations/20260806000002_seed_seasons_and_cups.sql
```

The second seeds all 18 seasons with their historical scoring rules.

```bash
npm run dev                      # from the repository root
```

## Two Supabase clients, deliberately different

| Client | Key | Sees |
|---|---|---|
| `lib/supabase/server.ts` | publishable | almost nothing — subject to RLS |
| `lib/supabase/admin.ts` | service role | everything, bypasses RLS |

The database is locked down: RLS is on for every table, no policies grant access,
and the API roles have had their privileges revoked. So the browser can read nothing
directly, and all real data access happens in server code holding the service-role
key.

`admin.ts` opens with `import 'server-only'`. If a client component ever imports it,
directly or through a chain, **the build fails** rather than shipping a key that can
read every member's phone number.

Authentication is magic-link. Note that a valid login is deliberately not enough:
access also requires a row in `app_users`, which only an admin can create.

## Scoring

All scoring comes from `@fwm/results-engine`, a workspace package. Do not
reimplement any of it here — the engine is verified against every result FWM has
published since 2009, and a second copy would drift.

See [results-engine/README.md](../results-engine/README.md), especially the
"things that will bite you" section.

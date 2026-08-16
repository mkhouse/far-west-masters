-- Migration 0026 — per-season membership, imported from AdminSkiRacing
--
-- Membership originates in ASR: a lapsed member becomes active by joining there, a
-- separate path with its own fee. So this system imports the answer rather than
-- maintaining one of its own, which it has demonstrably failed at — measured against
-- the 2025-2026 export, 63 people carry the wrong `people.status`.
--
-- THE EXPORT IS CUMULATIVE AND IS IMPORTED REPEATEDLY. The same file is downloaded
-- again every few weeks through the season to catch new members, and each download
-- contains everyone, not just the additions. Hence the unique constraint below: a
-- re-import of the same file must change nothing.
--
-- Safe to run after migrations 0001-0025, and safe to re-run.

-- ---------------------------------------------------------------------------
-- Membership, one row per person per season.
-- ---------------------------------------------------------------------------
create table if not exists memberships (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people (id) on delete cascade,

  -- As the club writes it: "2025-2026". Not derivable from the export — Event_id is
  -- the only identifier in the file and nothing in it names a season — so an officer
  -- types it once per import.
  season      text not null,

  -- ASR's own identifier for the season's membership event. Sequential, and recorded
  -- so a re-import of the same file is recognisably the same season rather than a
  -- second one under a mistyped label.
  event_id    text,

  -- The Registration Date column: when they actually joined, which is what makes
  -- "joined after the last import" answerable.
  joined_at   timestamptz,

  -- Race-day attributes as ASR held them at import time. Bib is assigned to only
  -- about four fifths of members, so it is optional.
  bib         text,
  class       text,

  -- The racer's HOME DIVISION, not the membership purchased. Everyone in the file
  -- is an FWM member for the season regardless of what this says — one is a Midwest
  -- racer who also bought FWM membership. Stored as an attribute; never filtered on.
  race_series text,

  source      text not null default 'asr_import',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- What makes a repeat import harmless.
  unique (person_id, season)
);

create index if not exists memberships_season_idx on memberships (season);
create index if not exists memberships_person_idx on memberships (person_id);

create trigger memberships_updated_at before update on memberships
  for each row execute function set_updated_at();

alter table memberships enable row level security;
grant all privileges on table memberships to service_role;

comment on table memberships is
  'Per-season membership, imported from AdminSkiRacing. Whether somebody is a member '
  'now is a lookup against this table, not a value stored on people.';

comment on column memberships.race_series is
  'The racer''s home division as ASR records it, NOT the membership purchased. Do not '
  'filter imports on this: one member races for Midwest and would be dropped.';

-- ---------------------------------------------------------------------------
-- A record of each import run.
--
-- Needed for the staleness warning, which asks "when did we last import" — a
-- question that cannot be answered from the membership rows themselves once anyone
-- edits one by hand.
-- ---------------------------------------------------------------------------
create table if not exists membership_imports (
  id               uuid primary key default gen_random_uuid(),
  season           text not null,
  event_id         text,
  imported_at      timestamptz not null default now(),
  imported_by      uuid references auth.users (id) on delete set null,
  -- Human-readable snapshot, for the same reason messages.sent_by exists: deleting
  -- an officer's account should not erase who ran an import.
  imported_by_label text,
  file_name        text,

  rows_in_file     int not null default 0,
  members_new      int not null default 0,
  members_updated  int not null default 0,
  members_missing  int not null default 0,
  people_unmatched int not null default 0,

  note             text
);

create index if not exists membership_imports_recent
  on membership_imports (imported_at desc);

alter table membership_imports enable row level security;
grant all privileges on table membership_imports to service_role;

comment on column membership_imports.members_missing is
  'Members present in an earlier import for this season and absent from this one. '
  'Flagged, never acted on: the export is cumulative, so a disappearance means a '
  'refund or a correction in ASR, and that is a decision for a person.';

-- ---------------------------------------------------------------------------
-- Preserve the old status before anything starts deriving membership.
--
-- people.status is wrong for roughly 63 people, and it is ALSO the only surviving
-- record of who was a member before 2025-2026 — ASR does not offer prior-season
-- exports and the Airtable backups never held them (task #53). Overwriting it would
-- trade an imperfect record for none, so it is copied aside and left alone.
-- ---------------------------------------------------------------------------
alter table people add column if not exists legacy_status person_status;

update people set legacy_status = status where legacy_status is null;

comment on column people.legacy_status is
  'The status carried over from Airtable, frozen at migration 0026. Unverifiable and '
  'known to be wrong for roughly 63 people, but the only trace of membership before '
  '2025-2026, which cannot be re-obtained. Historical only — never derive anything '
  'from it.';

comment on column people.status is
  'Legacy membership status. Superseded for "is this person a member now" by the '
  'memberships table, which is imported from ASR. Retained because it still carries '
  'the non-membership categories (officer, out_of_region, temp_racer, sms_opt_in).';

-- ---------------------------------------------------------------------------
-- Policy values, editable without a deploy like every other one.
-- ---------------------------------------------------------------------------
insert into app_settings (key, value, description) values
  (
    'membership_year_start',
    '09-01',
    'MM-DD. When membership lapses and the season label rolls over. Membership is '
    'annual and must be renewed, so on this date everybody ceases to be a member '
    'until they join again (Melissa, 2026-08-16). NOTHING RESETS ANYTHING: because '
    'membership is a row keyed by season rather than a flag on the person, nobody '
    'holds a row for the new season until they renew, so the change happens by '
    'itself. This value only decides which season label the app considers current.'
  ),
  (
    'season_start',
    '10-15',
    'MM-DD. The staleness warning for membership imports only applies from here. '
    'Renewals open around this date (Melissa, 2026-08-16), so before it there is '
    'genuinely nothing to import and a warning would be noise — and a warning people '
    'learn to ignore is worse than none.'
  ),
  (
    'season_end',
    '04-01',
    'MM-DD. See season_start.'
  ),
  (
    'membership_import_max_age_days',
    '14',
    'How old the most recent membership import may be, in season, before the app '
    'says so. People join throughout the season, so a stale import means new members '
    'are missing from the directory and from every audience — silently, which is why '
    'it needs saying out loud.'
  )
on conflict (key) do nothing;

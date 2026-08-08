-- Migration 0001 — initial schema
--
-- Generated from migration/schema.sql; see migration/schema-design.md for the
-- reasoning behind each table and migration/scoring-history.md for the scoring
-- rules the data model has to accommodate.
--
-- Safe to run once against a fresh project.

-- =============================================================================
-- FWM platform — initial schema
-- Postgres / Supabase. See schema-design.md for rationale.
--
-- Conventions:
--   * scoring math is NOT implemented here; the TS engine computes and stores it
--   * RLS is enabled everywhere and denies by default (see bottom of file)
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type gender          as enum ('M', 'F');
create type person_status   as enum ('active_member', 'inactive', 'officer', 'non_member');
create type discipline      as enum ('SL', 'GS', 'SG', 'DH', 'AC');
create type race_status     as enum ('scheduled', 'preliminary', 'official', 'canceled');
create type import_kind     as enum ('preliminary', 'official');
create type import_format   as enum ('live_timing', 'ace_html', 'csv');
create type app_role        as enum ('admin', 'processor');
create type message_status  as enum ('draft', 'sending', 'sent', 'failed');

-- Keep updated_at honest.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- People — members AND non-member racers. One row per human.
-- -----------------------------------------------------------------------------
create table people (
  id                 uuid primary key default gen_random_uuid(),

  first_name         text not null,
  last_name          text not null,
  nickname           text,
  -- name variant that shows up in timing results, when it differs
  results_first_name text,

  gender             gender,
  yob                int check (yob is null or yob between 1900 and 2100),
  usssa              bigint unique,          -- US Ski & Snowboard member number
  fis                bigint,

  status             person_status not null default 'non_member',

  -- contact (members only; never exposed to public pages — see RLS)
  phone              text,                   -- E.164, e.g. +15305551234
  email              text,
  asr_phone          text,                   -- as imported from AdminSkiRacing
  asr_email          text,

  -- SMS consent / suppression
  sms_always         boolean not null default false,  -- send race texts regardless of entry
  sms_never          boolean not null default false,  -- hard suppression, set by us
  intro_sent_at      timestamptz,                     -- gate: required before bulk sends
  opt_in_at          timestamptz,
  opted_out_at       timestamptz,                     -- set by inbound STOP

  -- opt-out from the public career-results profile (individual race results
  -- remain public; this suppresses the aggregated per-person page)
  hide_public_profile boolean not null default false,

  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index people_last_first_idx on people (lower(last_name), lower(first_name));
create index people_status_idx     on people (status);
create index people_phone_idx      on people (phone) where phone is not null;

create trigger people_updated_at before update on people
  for each row execute function set_updated_at();

-- Name variants seen in imported files, for reliable matching.
-- `alias` is stored normalized: casefolded "lastname, firstname".
create table person_aliases (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references people (id) on delete cascade,
  alias      text not null,
  source     text,                            -- live_timing | ace | asr | manual
  created_at timestamptz not null default now(),
  unique (person_id, alias)
);
create index person_aliases_alias_idx on person_aliases (alias);

-- Who can log in, and as what.
create table app_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  person_id  uuid references people (id) on delete set null,
  role       app_role not null default 'processor',
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Seasons and races (shared by both apps)
-- -----------------------------------------------------------------------------
-- Scoring rules are per-season, because they demonstrably change:
--   * age groups went from 10-year to 5-year bands in 2010
--   * the class-points scale went from top-15 (25,20,15,12,...) to the
--     top-30 World Cup scale (100,80,60,...) between 2016 and 2025
-- See cup-rules.md. Storing the rules with the season means historical results
-- stay explainable, and a future rule change is a data edit, not a code change.
create type age_group_scheme as enum ('five_year', 'ten_year');

create table seasons (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,        -- '2025-2026'
  year                  int  not null unique,        -- 2026 (the ending year)
  best_n                int  not null,               -- e.g. 12
  total_races           int,                         -- e.g. 16
  min_starts_for_award  int  not null default 6,

  -- class points by rank: points_scale[1] goes to 1st place. Ranks past the
  -- end of the array score 0.
  points_scale          int[] not null,
  age_groups            age_group_scheme not null default 'five_year',

  -- true once we've confirmed the rules above against published standings
  rules_verified        boolean not null default false,

  active                boolean not null default false,
  created_at            timestamptz not null default now()
);

-- Only one active season at a time.
create unique index seasons_one_active_idx on seasons (active) where active;

create table races (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references seasons (id) on delete cascade,

  name         text not null,                  -- 'Alpine SL - March 06, 2026 (1 of 2)'
  slug         text not null unique,           -- '20260306-alpine-sl-1of2'
  date         date not null,
  venue        text,
  discipline   discipline not null,
  factor       int  not null,                  -- 730/1010/1190/1250/1360, overridable
  run_count    int  not null default 2 check (run_count in (1, 2)),
  status       race_status not null default 'scheduled',

  -- grouping used when texting a race weekend ("Mammoth Nationals")
  series       text,
  series_order int,

  -- live-timing.com race id, entered once when the race is scheduled. Lets
  -- preliminary results be pulled directly from their data endpoint instead of
  -- being copy-pasted out of the rendered page. See live-timing-format.md.
  --
  -- One id per race: regular Far West races put both genders in a single
  -- live-timing race (verified on race 306870 — 68 men and 8 women together).
  -- Only national championships are split by gender, and those are handled as a
  -- special case rather than shaping this column.
  --
  -- This is live-timing's own sequential id and is unrelated to the US Ski &
  -- Snowboard race code below, so it cannot be derived from the fall schedule.
  live_timing_id int,

  -- US Ski & Snowboard race code, e.g. 'M0074'. Assigned per season in the fall
  -- and split by gender, so a race may carry more than one; kept for the official
  -- record and for cross-referencing the USSA schedule (which is also where
  -- cancellations are authoritative).
  usssa_race_code text,

  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index races_season_date_idx on races (season_id, date);
create index races_series_idx      on races (season_id, series);

create trigger races_updated_at before update on races
  for each row execute function set_updated_at();

-- Registration roster imported from AdminSkiRacing. Drives texting audiences.
create table race_entries (
  id          uuid primary key default gen_random_uuid(),
  race_id     uuid not null references races (id) on delete cascade,
  person_id   uuid not null references people (id) on delete cascade,
  source      text not null default 'adminskiracing',
  imported_at timestamptz not null default now(),
  unique (race_id, person_id)
);
create index race_entries_person_idx on race_entries (person_id);

-- -----------------------------------------------------------------------------
-- Results
-- -----------------------------------------------------------------------------

-- Raw payload of every import, kept permanently so the engine can be re-run
-- over history when a parser edge case is fixed.
create table race_imports (
  id             uuid primary key default gen_random_uuid(),
  race_id        uuid not null references races (id) on delete cascade,
  kind           import_kind   not null,
  format         import_format not null,
  raw_payload    text not null,             -- exact pasted text / uploaded HTML
  parsed         jsonb,                     -- parser output at import time
  parser_version text,
  imported_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index race_imports_race_idx on race_imports (race_id, created_at desc);

create table results (
  id               uuid primary key default gen_random_uuid(),
  race_id          uuid not null references races (id) on delete cascade,
  import_id        uuid references race_imports (id) on delete set null,

  -- nullable: an unmatched competitor still gets scored and displayed
  person_id        uuid references people (id) on delete set null,
  competitor_name  text not null,           -- as scored: 'Lastname, Firstname'
  bib              int,

  gender           gender not null,
  age_class        text   not null,         -- 'M9', 'F2', 'MOP'
  is_open_class    boolean not null default false,

  run1             text,                    -- time string or DNF/DNS/DSQ
  run2             text,                    -- null for single-run races
  total_seconds    numeric(9,3),            -- null when not a finisher
  total_display    text,                    -- '1:34.93'

  -- scoring (computed by the TS engine)
  class_rank       int,
  race_points      numeric(8,2),
  class_points     int,
  open_rank        int,
  open_race_points numeric(8,2),
  open_class_points int,

  -- which publication this row belongs to; both are kept so they can be diffed
  status           import_kind not null,
  created_at       timestamptz not null default now(),

  unique (race_id, competitor_name, status)
);

create index results_race_status_idx on results (race_id, status);
create index results_person_idx      on results (person_id) where person_id is not null;
create index results_unmatched_idx   on results (race_id) where person_id is null;

-- -----------------------------------------------------------------------------
-- Manual overrides on preliminary results
--
-- A referee can overturn a disqualification at the venue, long before the ski
-- area's timing file reaches the scorer, and results are announced from that
-- corrected picture. Overrides therefore live here rather than being edited into
-- the imported data: `race_imports.raw_payload` stays the evidence of what
-- live-timing actually said, and re-importing preliminary results cannot silently
-- discard a correction.
--
-- Applied on top of the import when results are computed. Scope is run status
-- (what referees actually change), not raw times.
-- -----------------------------------------------------------------------------
create table result_overrides (
  id             uuid primary key default gen_random_uuid(),
  race_id        uuid not null references races (id) on delete cascade,
  result_id      uuid references results (id) on delete cascade,
  competitor_name text not null,          -- survives a re-import replacing result rows

  -- which run, and what it becomes: a time string, or DNF/DNS/DSQ
  run            int  not null check (run in (1, 2)),
  original_value text,
  new_value      text not null,

  -- why, and by whom. Required: an unexplained override is worse than none.
  reason         text not null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  -- set once official results arrive, so a processor can see whether the official
  -- scoring agreed with the call made at the venue
  confirmed_by_official boolean,
  reconciled_at  timestamptz
);

create index result_overrides_race_idx on result_overrides (race_id);

alter table result_overrides enable row level security;

-- -----------------------------------------------------------------------------
-- Season standings (computed; recalculated after each official publish)
-- -----------------------------------------------------------------------------
create table standings (
  id               uuid primary key default gen_random_uuid(),
  season_id        uuid not null references seasons (id) on delete cascade,
  person_id        uuid references people (id) on delete set null,
  competitor_name  text not null,
  age_class        text not null,
  gender           gender not null,
  is_open_class    boolean not null default false,

  total_points     int  not null default 0,     -- sum of best-N finishes
  starts           int  not null default 0,
  finishes         int  not null default 0,
  class_rank       text,                        -- '1', '2', '3(t)'
  elected_open_mid_season boolean not null default false,  -- the '*' marker

  updated_at       timestamptz not null default now(),
  unique (season_id, competitor_name, is_open_class)
);

create table standing_entries (
  id                 uuid primary key default gen_random_uuid(),
  standing_id        uuid not null references standings (id) on delete cascade,
  race_id            uuid not null references races (id) on delete cascade,
  class_points       int,
  class_rank         int,
  open_class_points  int,
  open_class_rank    int,
  result             text,        -- 'DNF' | 'DNS' | 'DSQ' | null when finished
  counted            boolean not null default false,  -- counts toward best-N
  unique (standing_id, race_id)
);
create index standing_entries_race_idx on standing_entries (race_id);

-- -----------------------------------------------------------------------------
-- Cups (Bernard, Viva Italia, ...) — handicapped combined results
-- -----------------------------------------------------------------------------
-- Cups are not all scored the same way (see cup-rules.md):
--   age_handicap    Bernard Cup; Viva Italia from 1997
--   raw_combined    McKinney Cup / Silver Dollar Derby — fastest total time, no handicap
--   historical_only Viva Italia before 1997 ("Gianotti Criteria" — subjective,
--                   no formula exists; winners are recorded, never recomputed)
create type cup_scoring as enum ('age_handicap', 'raw_combined', 'historical_only');

create table cups (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references seasons (id) on delete cascade,
  name           text not null,
  slug           text not null unique,
  scoring_method cup_scoring not null default 'age_handicap',

  -- Handicap per five-year age class. ONE rate for the whole cup — deliberately
  -- not derived from the disciplines of the paired races.
  --
  -- Verified against every published cup 2010-2026: Viva Italia has always used
  -- 0.0300, and the Bernard Cup 0.0250 except in 2018 and 2020. Two all-slalom
  -- Bernard Cups (2015 and 2018) were scored at different rates, so this is a
  -- per-event decision rather than a rule. See cup-rules.md.
  handicap_rate  numeric(5,4) not null default 0.0250,
  created_at     timestamptz not null default now(),
  unique (season_id, name)
);

create table cup_races (
  cup_id   uuid not null references cups (id) on delete cascade,
  race_id  uuid not null references races (id) on delete cascade,
  ordinal  int  not null,          -- 1 = first race, 2 = second
  primary key (cup_id, race_id)
);

create table cup_results (
  id                    uuid primary key default gen_random_uuid(),
  cup_id                uuid not null references cups (id) on delete cascade,
  person_id             uuid references people (id) on delete set null,
  competitor_name       text not null,
  gender                gender not null,
  age_class             text,
  race_class_number     int,          -- 1..14, drives the handicap

  result1               text,         -- display time or DNF/DSQ
  result1_rank          int,
  result2               text,
  result2_rank          int,

  hcp1                  numeric(9,3),
  hcp2                  numeric(9,3),
  combined_hcp          numeric(9,3),
  combined_hcp_display  text,
  combined_raw          numeric(9,3),
  combined_raw_display  text,

  starts                int,
  finishes              int,
  position              text,         -- '1', '2', '-'
  sort_position         int,          -- 999 for DNF/DSQ
  created_at            timestamptz not null default now(),
  unique (cup_id, competitor_name)
);

-- -----------------------------------------------------------------------------
-- Texting
-- -----------------------------------------------------------------------------
create table messages (
  id           uuid primary key default gen_random_uuid(),
  body         text not null,
  -- audience: a race, a whole series, or an ad-hoc selection
  race_id      uuid references races (id) on delete set null,
  series       text,
  audience     jsonb,                    -- filter snapshot, for the log
  status       message_status not null default 'draft',
  segments     int,                      -- SMS segment count at send time
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create table message_recipients (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references messages (id) on delete cascade,
  person_id   uuid references people (id) on delete set null,
  phone       text not null,             -- captured at send time
  twilio_sid  text,
  status      text,                      -- queued | sent | delivered | failed
  error       text,
  sent_at     timestamptz,
  unique (message_id, phone)
);
create index message_recipients_person_idx on message_recipients (person_id);

create table inbound_messages (
  id            uuid primary key default gen_random_uuid(),
  from_phone    text not null,
  person_id     uuid references people (id) on delete set null,
  body          text not null,
  twilio_sid    text unique,
  is_stop       boolean not null default false,
  forwarded_to  text,                    -- membership director's number
  forwarded_at  timestamptz,
  received_at   timestamptz not null default now()
);
create index inbound_messages_received_idx on inbound_messages (received_at desc);

-- -----------------------------------------------------------------------------
-- Convenience view: who may receive a bulk SMS right now.
-- Consent policy only — no scoring logic. Audience filtering happens in the app.
-- -----------------------------------------------------------------------------
create view sms_eligible_people
with (security_invoker = true) as
select p.*
from people p
where p.phone is not null
  and p.sms_never    = false
  and p.opted_out_at is null
  and p.intro_sent_at is not null;   -- intro/consent text must have gone out first

-- -----------------------------------------------------------------------------
-- Row Level Security: enable everywhere, grant nothing.
--
-- No policies are defined, so the anon and authenticated roles can read/write
-- nothing directly. All access goes through server-side code using the service
-- role key, which never reaches the browser. Public results pages are rendered
-- server-side at publish time.
--
-- This is deliberate: the anon key is public, and this database holds member
-- phone numbers and email addresses.
-- -----------------------------------------------------------------------------
alter table people              enable row level security;
alter table person_aliases      enable row level security;
alter table app_users           enable row level security;
alter table seasons             enable row level security;
alter table races               enable row level security;
alter table race_entries        enable row level security;
alter table race_imports        enable row level security;
alter table results             enable row level security;
alter table standings           enable row level security;
alter table standing_entries    enable row level security;
alter table cups                enable row level security;
alter table cup_races           enable row level security;
alter table cup_results         enable row level security;
alter table messages            enable row level security;
alter table message_recipients  enable row level security;
alter table inbound_messages    enable row level security;

-- -----------------------------------------------------------------------------
-- Explicitly remove API-role privileges.
--
-- The project was created with "automatically expose new tables" disabled, so
-- this should already be the case. Stating it in the migration means the
-- guarantee travels with the schema rather than depending on a dashboard
-- checkbox someone might flip later.
--
-- Server-side code uses the service_role key, which is unaffected by both these
-- revokes and by RLS.
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- service_role, by contrast, needs full access — it is the trusted server-side
-- identity that all legitimate data access flows through.
--
-- This grant is required because the project disables "automatically expose new
-- tables". That setting is correct (nothing reaches the browser by accident) but it
-- withholds privileges from service_role too, not only from anon and authenticated.
-- Without this, the server key gets "permission denied for table seasons".
grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

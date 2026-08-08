-- Migration 0014 — named recipient groups
--
-- Generalises the single test-recipient flag into named groups an admin can create
-- and edit: test groups now, and later things like officials or board members.
--
-- Supersedes the never-applied migration 0013, which added a single
-- people.is_test_recipient flag. That file has been removed: a boolean column
-- cannot express "a group of just Melissa and Damian", let alone officials or board
-- members later.
--
-- Safe to run after migrations 0001-0012.

create table recipient_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,

  -- Whether messages to this group skip the usual opt-in and intro-text checks.
  --
  -- False by default, and it should stay false for most groups: board members and
  -- officials are still people who need to have agreed to receive texts. The
  -- exception is test groups, where the whole point is that the message arrives.
  --
  -- Kept as an explicit per-group flag rather than special-casing certain names,
  -- so an audience that bypasses consent is always something someone chose and can
  -- be seen to have chosen.
  bypasses_consent_gate boolean not null default false,

  -- Marks a group as a test target, so the compose screen can default to it. The
  -- safe default when someone opens the screen and starts typing.
  is_test_group boolean not null default false,

  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null
);

create table recipient_group_members (
  group_id   uuid not null references recipient_groups (id) on delete cascade,
  person_id  uuid not null references people (id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (group_id, person_id)
);

create index recipient_group_members_person_idx on recipient_group_members (person_id);

alter table recipient_groups        enable row level security;
alter table recipient_group_members enable row level security;
grant all privileges on table recipient_groups        to service_role;
grant all privileges on table recipient_group_members to service_role;

comment on table recipient_groups is
  'Named audiences an admin can maintain — test groups, officials, board members. '
  'bypasses_consent_gate is per group and defaults to false; only test groups '
  'should normally set it.';

-- -----------------------------------------------------------------------------
-- Seed the two test groups
-- -----------------------------------------------------------------------------
insert into recipient_groups (name, description, bypasses_consent_gate, is_test_group)
values
  ('Test — Melissa', 'Single recipient, for checking a message before anyone else sees it.', true, true),
  ('Test — Melissa and Damian', 'Two recipients, for checking a message reads well on more than one handset.', true, true)
on conflict (name) do nothing;

-- Who is IN those groups is deliberately not here.
--
-- This repository is public. Putting members' email addresses in a migration would
-- publish them, and the people concerned did not agree to that — the same rule that
-- keeps the Airtable backups outside the repo entirely.
--
-- So the groups are created empty, and membership is seeded from
-- `supabase/local/seed-test-groups.sql`, which is gitignored. Add people through
-- the admin screen at /admin/groups, or from that file.
--
-- A fresh environment therefore starts with two empty test groups. That is the
-- safe direction to fail: an empty audience sends nothing, whereas a seeded one
-- could text someone who never opted in.

-- Migration 0028 — saved message templates
--
-- Mary writes the same seven messages over and over, by hand, from her own phone.
-- Migration 0023 stored one of them (the intro text) and gave the reason: typing the
-- same message repeatedly produces drift — five slightly different versions of what
-- was meant to be one message. This does the same job for the rest.
--
-- What a template is, precisely: text with blanks. Not fixed wording. Every message
-- Mary sends to a member opens with their first name, and five of the seven identify
-- her by name. Stored as fixed text those would either be wrong for the member or
-- wrong for the officer — so the blanks are the point, not an embellishment. The
-- placeholder set lives in web/src/lib/templates.ts, which is the one place that
-- decides what may appear between braces.
--
-- WHY THE BODY IS STORED ALREADY-CLEANED. Two of the real messages contain a curly
-- apostrophe in "don't", inserted automatically by a Mac or an iPhone and invisible
-- on screen. It forces UCS-2, which cuts a segment from 160 characters to 70:
--
--   Racer profile / credit card    5 segments as typed, 2 once straightened
--   Short-term licence             3 segments as typed, 2 once straightened
--
-- Sent from an officer's own phone that costs nothing. Stored here and sent through
-- the app it is a permanent 2.5x multiplier on every use, for a character nobody can
-- see. So the editor runs fixSmartCharacters() on save, the same function the compose
-- box already applies as you type, and what is stored is what will be sent.
--
-- Length is NOT constrained. These messages run 133-264 characters and only two fit
-- in a single segment; that is fine, because they are read by one person rather than
-- blasted to three hundred. The editor shows the segment count and leaves the
-- judgement to the officer. A template written for a personal text has no segment
-- budget at all.
--
-- Safe to run after migrations 0001-0027.

-- The five kinds the real messages fall into. An enum rather than free text because
-- this is the list a template picker offers, and a typo would silently create a sixth
-- category that appears nowhere.
create type template_category as enum (
  'new_member',      -- welcoming somebody who has just joined
  'race_logistics',  -- bib pickup, course inspection, start times
  'action_required', -- something the member must do before race day
  're_engagement',   -- checking in with somebody who has stopped showing up
  'question'         -- answering a question a member asked
);

create table message_templates (
  id          uuid primary key default gen_random_uuid(),

  -- What an officer picks it by. Not shown to the member.
  name        text not null,
  category    template_category not null,

  -- The message, with placeholders. Stored straightened — see above.
  body        text not null,

  -- Archived rather than deleted. A template that has been used is part of the
  -- record of how the club has communicated, and the send log stores the resulting
  -- message rather than a reference, so deleting one loses the wording without
  -- gaining anything.
  archived_at timestamptz,

  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Unique among the live ones only. Archiving "Bib pickup" and writing a new one with
-- the same name is a reasonable thing to do; two live templates with one name is not,
-- because the picker would show them identically.
create unique index message_templates_live_name_idx
  on message_templates (lower(name))
  where archived_at is null;

create index message_templates_category_idx
  on message_templates (category)
  where archived_at is null;

create trigger message_templates_updated_at before update on message_templates
  for each row execute function set_updated_at();

comment on table message_templates is
  'Saved message wording with placeholders, filled when an officer picks a person to '
  'contact. Bodies are stored with smart punctuation already replaced, because a '
  'curly apostrophe forces UCS-2 and cuts the segment size from 160 characters to 70.';

comment on column message_templates.body is
  'The message, with placeholders in braces — {first name}, {officer name}, '
  '{officer phone}, {venue}, {next venue}, {time}. The authoritative list is '
  'PLACEHOLDERS in web/src/lib/templates.ts; anything else between braces is '
  'rejected by the editor rather than sent to a member literally.';

-- RLS on, no policies. Every read goes through service_role, which bypasses RLS by
-- design; anon and authenticated get nothing. Same boundary as every other table
-- here — see migration 0004.
alter table message_templates enable row level security;

-- Migration 0015 — what a message was sent to, and what happened to each one
--
-- Sending is the one irreversible thing this system does. A results import can be
-- corrected; a text cannot be unsent. So the record has to be good enough to answer,
-- weeks later, exactly who received what and why.
--
-- `if not exists` throughout: `messages.series` was already present from the initial
-- schema, and a migration that fails halfway is worse than one written defensively.
--
-- Safe to run after migrations 0001-0014, and safe to re-run.

-- Which audience a message was sent to, captured as it was at send time. The group
-- may be renamed or its membership changed afterwards; this records what was
-- actually chosen.
alter table messages
  add column if not exists audience_kind  text,
  add column if not exists audience_label text,
  add column if not exists group_id       uuid references recipient_groups (id) on delete set null,

  -- Whether this send skipped the opt-in and intro-text checks, and so whether it
  -- needs explaining. Only intro texts and test sends legitimately do, which makes a
  -- true value here something an auditor should be able to see and question.
  add column if not exists bypassed_consent_gate boolean not null default false,

  -- A short human label the sender types, carried over from the Airtable form's
  -- "short purpose of text". Makes the log readable months later.
  add column if not exists purpose text;

-- `messages.series` already exists from migration 0001 and is reused as-is.

comment on column messages.audience_label is
  'The audience as chosen at send time. Stored rather than derived, because a group '
  'can be renamed or its membership changed after the fact.';

-- Per-recipient delivery state from Twilio.
alter table message_recipients
  -- queued -> sent -> delivered, or failed / undelivered.
  add column if not exists delivery_status text,
  add column if not exists error_code      text,
  add column if not exists segments        int,
  add column if not exists updated_at      timestamptz not null default now();

comment on column message_recipients.delivery_status is
  'Latest status from Twilio. Delivery is asynchronous: a message accepted by the '
  'API can still fail at the carrier minutes later, so this is updated by webhook '
  'rather than set once at send time.';

-- Sending is idempotent per recipient. If a send is retried after a partial failure,
-- this stops anyone receiving the message twice — the failure mode people actually
-- notice and complain about.
create unique index if not exists message_recipients_unique_person
  on message_recipients (message_id, person_id)
  where person_id is not null;

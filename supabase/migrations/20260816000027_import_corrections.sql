-- Migration 0027 — record how many corrections an import accepted
--
-- A membership import fills gaps automatically and offers everything else as a
-- choice: where AdminSkiRacing disagrees with a value we already hold, an officer
-- ticks the ones to take. On the first 2025-2026 import six were accepted and nine
-- declined.
--
-- None of that was recorded. `members_updated` counted people who were already
-- members and had something change, which on a first import is zero by definition —
-- so the run read as though it had changed nothing but the memberships, when it had
-- rewritten six people's email addresses.
--
-- Months later "what did that import actually do" is a question with consequences,
-- and it should not need the original CSV to answer.
--
-- Safe to run after migrations 0001-0026, and safe to re-run.

alter table membership_imports
  add column if not exists corrections_accepted int not null default 0,
  add column if not exists corrections_offered  int not null default 0;

comment on column membership_imports.corrections_accepted is
  'Values an officer chose to overwrite with AdminSkiRacing''s version — a phone '
  'number or email address that we already held and that ASR disagreed with. '
  'Deliberate, per-row decisions, not something the import did on its own.';

comment on column membership_imports.corrections_offered is
  'How many disagreements were presented. The gap between this and '
  'corrections_accepted is what was deliberately left alone, which is as much a '
  'decision as taking one.';

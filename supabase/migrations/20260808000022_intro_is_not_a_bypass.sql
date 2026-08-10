-- Migration 0022 — an intro text is not a bypass
--
-- Documentation only: no data changes, no schema changes. It records a correction
-- to what the system believed about its own consent rule.
--
-- The intro-text audience was built as "people entered in a race who have never had
-- an intro text", and it never checked `opt_in_at`. The assumption was that an intro
-- text is a first contact, justified by someone having registered for a race.
--
-- That is not FWM's flow, and more importantly it is not the flow described to
-- Twilio when the toll-free number was verified. Members opt in on a form FIRST; the
-- intro text follows and confirms it. Texting somebody to ask them to opt in would
-- contradict the consent process the club's number was approved under.
--
-- So the audience now requires `opt_in_at` like every other audience, and is scoped
-- to everyone awaiting an introduction rather than to a race weekend — because the
-- trigger is a completed form, not a race entry.
--
-- Two consequences worth recording:
--
--   1. NOTHING IN THIS SYSTEM MESSAGES ANYONE WHO HAS NOT OPTED IN. There is no
--      remaining bypass of any kind. `recipient_groups.bypasses_consent_gate` was
--      retired in migration 0020; this retires the last one.
--
--   2. `intro_sent_at` is now actually written. Nothing had ever set it, so the
--      intro audience could never shrink: the same people would have received the
--      introduction on every run and never become eligible for ordinary messages.
--      The application now stamps it after a send, for accepted recipients only.
--
-- Safe to run after migrations 0001-0021, and safe to re-run.

comment on column messages.bypassed_consent_gate is
  'True when the message went to members whose consent was not yet complete — in '
  'practice, an intro text to someone who had opted in but not yet been introduced. '
  'Despite the column name, this never means consent was absent: opt-in is required '
  'for every audience. Kept under its original name so historical rows keep their '
  'meaning.';

comment on column people.intro_sent_at is
  'When FWM sent the intro text confirming this member opted in. Written by the '
  'application after an intro send, for recipients Twilio accepted only — a failed '
  'send introduced nobody. Together with opt_in_at this forms the consent gate; see '
  'the sms_eligible_people view.';

-- How many members are waiting on an introduction. This is the audience the intro
-- campaign works through, and it should shrink each time one is sent.
select
  count(*) filter (where opt_in_at is not null and intro_sent_at is null) as awaiting_intro,
  count(*) filter (where opt_in_at is not null and intro_sent_at is not null) as fully_consented,
  count(*) filter (where opt_in_at is null) as never_opted_in
from people;

-- Migration 0020 — recipient groups always check consent
--
-- Groups could be marked as skipping the opt-in and intro-text checks. That existed
-- for the test groups, on the assumption that testing needed to reach people who
-- had not been through the consent flow.
--
-- It turned out to be unnecessary. Testers are officers and officials, and they
-- have all opted in like everyone else — both test groups' members already passed
-- the gate on their own, so the flag was never actually changing who received
-- anything.
--
-- Removing it is worth more than the flexibility it offered. An audience that can
-- silently skip consent is the kind of thing that is set once for a good reason and
-- then forgotten, and the cost of forgetting is a text to somebody who never agreed
-- to receive one.
--
-- The column stays rather than being dropped: dropping is destructive, and
-- `messages.bypassed_consent_gate` still legitimately records intro-text sends. But
-- the application no longer reads it for groups, and the option is gone from the
-- admin screen — so setting it here now achieves nothing.
--
-- WHAT STILL BYPASSES THE GATE: intro texts (the `series_intro` audience). Those go
-- by definition to race entrants who have never had an intro text, which is exactly
-- what the gate blocks. That is a separate code path, not a group setting, and every
-- such send is recorded and shown as "consent gate bypassed" on the message.
--
-- Safe to run after migrations 0001-0019, and safe to re-run.

update recipient_groups
set bypasses_consent_gate = false
where bypasses_consent_gate;

comment on column recipient_groups.bypasses_consent_gate is
  'No longer honoured. Group audiences always apply the consent gate. Retained '
  'only so historical rows keep their shape; setting it has no effect. The one '
  'remaining bypass is the intro-text audience, which is decided in code.';

-- Confirm. Should return no rows.
select name, bypasses_consent_gate
from recipient_groups
where bypasses_consent_gate;

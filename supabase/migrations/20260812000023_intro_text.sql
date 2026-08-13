-- Migration 0023 — store the intro text once
--
-- The intro text was sent 145 times from Airtable, in five slightly different
-- versions: "replies to this number" and "replies to this message", one missing the
-- raceadmin line, one missing a full stop. That is what typing the same message
-- repeatedly does. Storing it once removes the drift, and lets an admin change the
-- wording without a developer.
--
-- TWO CHANGES FROM THE AIRTABLE WORDING, both deliberate:
--
--   1. It no longer ends with "Text STOP to stop." The application appends the
--      opt-out line to every message now (migration 0018), so including it here
--      would send it twice — or, thanks to the duplicate check, silently not.
--      Either way, it does not belong in the body.
--
--   2. "Do not reply, we can not respond to replies to this number" is gone. That
--      is no longer true: replies are forwarded to whichever officer is named on
--      the message. It is replaced with a neutral line pointing at email rather
--      than an invitation to reply — a welcome text should not generate a stream of
--      conversations nobody has agreed to monitor.
--
-- The compose screen fills this in when the intro audience is chosen. It is not
-- sent automatically: a stored template is exactly the sort of thing that drifts
-- out of date unnoticed, and sending is the one thing here that cannot be undone.
--
-- Safe to run after migrations 0001-0022, and safe to re-run.

insert into app_settings (key, value, description) values
  (
    'sms_intro_text',
    'Hello! This is the Far West Masters text messaging service. We use this number to send race announcements and other time-sensitive information. Questions? Email raceadmin@farwestmasters.org',
    'The introduction sent to members who have opted in but not yet been introduced. '
    'Sending it is what completes their consent and moves them into the regular '
    'audiences. Do NOT include an opt-out line — the application appends one. Keep '
    'it under about 280 characters to stay within two segments.'
  )
on conflict (key) do nothing;

-- Check the length. 288 characters is the two-segment ceiling once the 18-character
-- opt-out line is added; beyond that every recipient costs a third message.
select
  length(value) as body_characters,
  length(value) + 18 as with_opt_out,
  case
    when length(value) + 18 <= 160 then '1 segment'
    when length(value) + 18 <= 306 then '2 segments'
    else 'THREE OR MORE — shorten it'
  end as cost
from app_settings
where key = 'sms_intro_text';

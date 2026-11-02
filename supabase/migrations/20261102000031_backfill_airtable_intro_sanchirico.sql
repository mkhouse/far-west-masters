-- Migration 0031 — record an intro text that Airtable sent, so we do not send it twice
--
-- SENDS NOTHING. This writes a date onto one row. It is here precisely so that a
-- send which already happened is not repeated.
--
-- WHAT WENT WRONG. The club's SMS history is in two halves. Everything before
-- autumn 2025 went out through the Airtable base and its own automation; everything
-- since goes through this application. The migration across carried members, consent
-- dates and race history, but NOT the Airtable messaging log — so a member whom
-- Airtable had already introduced arrived here with `intro_sent_at` empty, and has
-- been sitting in the "Opted-in, needs intro text" audience ever since, waiting for a
-- message he received nineteen months ago.
--
-- James Sanchirico is the one person this affected. The evidence, from three sources:
--
--   * Airtable's Messaging log (backed up 2026-08-07) holds an "SMS Intro" to
--     +16508140065 at 2025-03-09T22:58Z — thirteen minutes after his opt-in at
--     22:45:13. That log is the authoritative record for that era.
--   * This application has no send attempt against him at all, which is why he shows
--     as needing one.
--   * Twilio cannot confirm or deny: the current account's message history begins
--     17 October 2025, months after the send. Its silence is not evidence.
--
-- Checked against the other two members in the same audience, and they are NOT the
-- same case — Airtable's log has no intro for either, and for Robert Barnett (opted
-- in February 2026, inside the current Twilio account's window) Twilio confirms no
-- message was ever sent to his number. Those two genuinely need an intro, and are
-- deliberately left alone here so they stay in the audience.
--
-- WHY THE DATE IS 2025, NOT TODAY. `intro_sent_at` records when the club actually
-- introduced itself. Stamping today's date would be convenient and false — it would
-- claim a message was sent this week that was in fact sent in March 2025, and it
-- would do so in the one field anybody looks at to work out whether a member has
-- heard from the club. The same reasoning the opt-in review queue applies to consent
-- dates applies here.
--
-- Safe to run after migrations 0001-0030, and safe to re-run: the `intro_sent_at is
-- null` guard means a second run changes nothing.

update people
set intro_sent_at = '2025-03-09T22:58:00+00:00'
where phone = '+16508140065'
  and lower(email) = 'james.sanchirico@gmail.com'
  -- Both keys must agree, so a recycled phone number or a shared mailbox cannot
  -- quietly stamp the wrong person as introduced.
  and intro_sent_at is null;

-- Expect exactly one row, with the 2025 date.
select
  first_name,
  last_name,
  opt_in_at,
  intro_sent_at,
  case
    when intro_sent_at is null then 'STILL NULL - the update did not match'
    when intro_sent_at::date = date '2025-03-09' then 'correct'
    else 'UNEXPECTED DATE - check this'
  end as result
from people
where phone = '+16508140065';

-- And the audience this was about. Expect exactly two people now — Brock de Lappe
-- and Robert Barnett — both of whom genuinely need an intro text.
select
  first_name,
  last_name,
  opt_in_at::date as opted_in,
  phone
from people
where opt_in_at is not null
  and intro_sent_at is null
  and opted_out_at is null
  and sms_never = false
  and phone is not null
order by opt_in_at;

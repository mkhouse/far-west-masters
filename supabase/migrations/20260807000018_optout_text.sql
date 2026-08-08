-- Migration 0018 — the app appends the opt-out line, and owns the wording
--
-- Until now the opt-out line was assumed to be Twilio's job, and the only thing
-- stored here was how many characters it cost: `sms_optout_append_length = 18`.
--
-- The first real test send arrived WITHOUT it. Every message FWM sent through the
-- old Airtable app carried "Text STOP to stop" on its own line, so that line was
-- being added by Airtable, not by Twilio. Two things follow:
--
--   1. FWM's stated policy — the opt-out line on every message, because it protects
--      sender reputation — was about to be silently broken.
--   2. The composer was reserving 18 characters for text nobody was adding, so every
--      message had 18 characters less room than it really had.
--
-- So the app appends it now. Which means the wording has to live here, not a count
-- of its characters: a number that has to be kept in step with a string is a number
-- that eventually is not. The length is derived from the text, so changing the
-- wording corrects the character budget automatically.
--
-- If Twilio is ever configured to append opt-out language itself — a Messaging
-- Service with that feature enabled — set this to the empty string rather than
-- leaving both to append and sending it twice.
--
-- Safe to run after migrations 0001-0017, and safe to re-run.

insert into app_settings (key, value, description) values
  (
    'sms_optout_text',
    'Text STOP to stop',
    'Opt-out line appended to every outbound message, on its own line, after any '
    'reply notice. Counts toward the segment budget, and the composer derives that '
    'cost from this text — so edit the wording here and nothing else. Set to an '
    'empty string ONLY if Twilio is configured to append opt-out language itself, '
    'otherwise members receive it twice.'
  )
on conflict (key) do nothing;

-- Superseded. Kept nowhere: a stale character count that no longer matches the text
-- would be worse than absent, because the composer would quietly miscount segments
-- and the error would only show up on the bill.
delete from app_settings where key = 'sms_optout_append_length';

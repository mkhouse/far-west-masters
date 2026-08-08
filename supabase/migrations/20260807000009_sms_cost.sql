-- Migration 0009 — estimated SMS cost per segment
--
-- So the compose screen can show what a send will cost, not just how many messages
-- it will produce. "861 messages" is abstract; "$9.38" is a decision.
--
-- The default is the US A2P 10DLC effective rate as of 2026:
--
--   $0.0079   Twilio outbound SMS, per segment
--   $0.0030   carrier surcharge for registered A2P traffic (up to $0.005 on some
--             carriers, so this is the optimistic end)
--   -------
--   $0.0109   per segment
--
-- Not included, because they are monthly rather than per-message: the phone number
-- (~$1.15/month), A2P brand registration (~$4/month) and campaign registration
-- (~$10/month).
--
-- Rates vary by volume and carrier, so this is a setting rather than a constant.
-- Check the real figure against a Twilio invoice and correct it here — an estimate
-- that is quietly wrong is worse than no estimate at all.
--
-- Safe to run after migrations 0001-0008.

insert into app_settings (key, value, description) values
  (
    'sms_cost_per_segment_usd',
    '0.0109',
    'Estimated cost in USD of one outbound SMS segment, used to show the cost of a '
    'send before it happens. Default is Twilio''s US rate ($0.0079) plus the A2P '
    '10DLC carrier surcharge ($0.003). Excludes monthly number and registration '
    'fees. Verify against an invoice and update.'
  )
on conflict (key) do nothing;

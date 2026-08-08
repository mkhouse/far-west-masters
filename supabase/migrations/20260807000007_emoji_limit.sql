-- Migration 0007 — emoji cap
--
-- Emoji and accented characters are allowed in messages. The cap is about tone and
-- deliverability, not encoding: three emoji reads as friendly, fifteen reads as
-- spam, and carriers judge sender reputation partly on that.
--
-- Note this is separate from the length limits. Emoji do cost budget — any one of
-- them forces UCS-2, cutting the per-segment limit from 160 characters to 70 — but
-- that is a cost the composer displays, not a reason to forbid them.
--
-- Safe to run after migrations 0001-0006.

insert into app_settings (key, value, description) values
  (
    'sms_max_emoji',
    '3',
    'Maximum emoji per message. Accented characters and emoji are permitted; this '
    'caps quantity for tone and carrier reputation. Typographic symbols such as '
    'copyright and trademark do not count.'
  )
on conflict (key) do nothing;

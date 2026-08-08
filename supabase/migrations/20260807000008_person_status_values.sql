-- Migration 0008 — the member categories FWM actually uses
--
-- The initial schema guessed at four categories. The Airtable base has seven, and
-- the extra three are distinctions that matter for who gets messaged:
--
--    154  Active FWM Member
--     78  Inactive
--     53  Added by ASR import       <- registered for a race, not confirmed as a member
--     12  FWM Officers
--      6  Out of region racer       <- races with FWM but belongs to another division
--      5  Manual add for SMS opt-in <- asked to receive texts, not a member
--      1  Temp racer
--
-- Collapsing those into `non_member` would lose real targeting information — an
-- out-of-region racer and someone who simply asked for texts are not the same
-- audience.
--
-- Recall that this field is an operational category for messaging, not a membership
-- record: membership is verified by the membership director at registration and is
-- not modelled here (see migration 0003).
--
-- Safe to run after migrations 0001-0007.

alter type person_status add value if not exists 'asr_import';
alter type person_status add value if not exists 'out_of_region';
alter type person_status add value if not exists 'sms_opt_in';
alter type person_status add value if not exists 'temp_racer';

comment on column people.status is
  'Operational category for messaging, mirroring the Airtable "Status" field: '
  'active_member, inactive, officer, asr_import, out_of_region, sms_opt_in, '
  'temp_racer, non_member. NOT a membership record — see migration 0003.';

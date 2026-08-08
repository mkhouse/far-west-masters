-- Migration 0010 — the bulk-messaging consent gate
--
-- FWM requires BOTH signals before a member may receive bulk messages:
--
--   opt_in_at      they submitted the opt-in form, volunteering consent
--   intro_sent_at  FWM sent the intro text, confirming it
--
-- The original view checked only intro_sent_at, mirroring the Airtable base. That
-- was too loose: an intro text can be sent to someone who never asked for one, so on
-- its own it records that FWM made contact, not that the member agreed.
--
-- Against current data the difference is small but real:
--
--   intro text only          94 people   (the old rule)
--   opt-in form only         96
--   BOTH (this rule)         93
--   either one               97
--
-- The four people the stricter rule excludes are not lost — they surface in the
-- opt-in review queue, which exists to move people from "consented" to "reachable".
--
-- Deliberately NOT gated here: the intro text itself, which by definition goes to
-- people who have not passed this gate. Otherwise nobody could ever become
-- eligible. That send is authorised explicitly in the audience picker, and it is the
-- only send permitted to bypass this view.
--
-- Safe to run after migrations 0001-0009.

drop view if exists sms_eligible_people;

create view sms_eligible_people
with (security_invoker = true) as
select p.*
from people p
where p.phone is not null
  -- Set by an inbound STOP. Absolute: overrides every other signal.
  and p.opted_out_at is null
  -- Set by us, to suppress someone regardless of what they have agreed to.
  and p.sms_never = false
  -- Both halves of consent, per FWM policy.
  and p.opt_in_at is not null
  and p.intro_sent_at is not null;

comment on view sms_eligible_people is
  'Members who may receive a bulk message: a phone number, not opted out, not '
  'suppressed, and BOTH consent signals present (opt-in form and intro text). The '
  'intro text send itself must not use this view — it targets people who have not '
  'yet passed the gate.';

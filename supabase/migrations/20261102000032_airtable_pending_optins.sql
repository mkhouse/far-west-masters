-- Migration 0032 — bring two Airtable opt-ins into the review queue
--
-- SENDS NOTHING. It inserts two rows into `opt_in_submissions` with status
-- 'pending', which makes them appear at /admin/opt-ins. The intro text goes out when
-- an officer acts on them there, not when this runs.
--
-- WHY THERE ARE AIRTABLE OPT-INS IN NOVEMBER 2026. The club's website still sends
-- members to the old Airtable form: farwestmasters.org/communication has a button
-- labelled "FWM Text Messaging Registration" pointing at the Airtable base, not at
-- optin.mkinthehouse.com. So members have gone on opting in through a form this
-- application never sees. These two are the ones that arrived before anybody noticed.
--
-- **Repointing that button is the actual fix.** Until it is changed, this will happen
-- again, and it is also why the Airtable account cannot be closed yet: closing it
-- breaks the opt-in path that the toll-free verification describes.
--
-- WHY THEY WERE STUCK EVEN IN AIRTABLE. Both carry
-- "ERROR: Member lookup failed. No record found." Airtable could not match them to a
-- member and had nowhere to put them, so nothing happened at all. This application
-- has somewhere to put them — the review queue exists for exactly this case, and
-- RUNBOOK.md names it: somebody joining the club is registering with AdminSkiRacing
-- at that moment, so they are genuinely not in `people` yet. They consented, they
-- were thanked, and without a review screen they hear nothing.
--
-- Confirmed against `people`: neither appears, by email or by surname.
--
-- WHY `created_at` IS BACKDATED. The review queue dates consent to the submission,
-- not to the review — "the member agreed when they filled in the form; the delay is
-- ours, and stamping an officer's convenience onto a member's decision would make the
-- record wrong" (migration 0025). That only works if the submission carries its real
-- time, so these rows are inserted with theirs.
--
-- The times come from the Airtable export, which renders Pacific. US daylight time
-- ended at 02:00 on 1 November 2026, so both of these — 16:16 and 22:07 — are PST,
-- UTC-8. Written with the offset so Postgres does the conversion rather than anybody
-- doing it in their head.
--
-- WHAT TO DO AFTER RUNNING THIS: open /admin/opt-ins. Each will offer "Add as new",
-- which creates the person as `sms_opt_in`, records consent dated to the submission
-- below, and sends the intro text. The screen re-checks matching when it loads, so if
-- either has since been imported from AdminSkiRacing it will offer "Link to a member"
-- instead — which is the right answer and the reason this goes through the queue
-- rather than creating people here.
--
-- Safe to run after migrations 0001-0031, and safe to re-run: the `where not exists`
-- guard keys on phone, so a second run inserts nothing.

insert into opt_in_submissions
  (first_name, last_name, email, phone_raw, phone, consented, status, created_at, note)
select
  v.first_name, v.last_name, v.email, v.phone_raw, v.phone, true, 'pending',
  v.created_at::timestamptz,
  'Submitted through the Airtable form, which the club website still links to. '
  'Airtable could not match them to a member ("Member lookup failed") so nothing '
  'was sent. Carried across by migration 0032.'
from (values
  ('Jeffrey', 'DeLong', 'DELONGJEFFREY@GMAIL.COM', '(801) 554-4185', '+18015544185',
   '2026-11-01 16:16:00-08'),
  ('Jim', 'Damask', 'jim.damask@gmail.com', '(415) 412-9652', '+14154129652',
   '2026-11-01 22:07:00-08')
) as v(first_name, last_name, email, phone_raw, phone, created_at)
where not exists (
  select 1 from opt_in_submissions existing
  where existing.phone = v.phone
);

-- Expect two rows, both pending, both dated 1 November 2026.
select
  created_at,
  first_name,
  last_name,
  phone,
  status,
  case when person_id is null then 'not linked yet - review at /admin/opt-ins'
       else 'linked' end as next_step
from opt_in_submissions
order by created_at desc
limit 5;

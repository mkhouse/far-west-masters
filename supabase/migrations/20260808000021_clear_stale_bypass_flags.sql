-- Migration 0021 — clear the bypass flag from group sends
--
-- Six early test messages are marked "consent gate bypassed". They were sent to the
-- test groups, which at the time were configured to skip the opt-in and intro-text
-- checks, so the send took the bypass path and recorded that honestly.
--
-- But nobody was actually reached without consent. Every recipient of all six had
-- both opt_in_at and intro_sent_at set BEFORE the message was sent — verified before
-- writing this. The bypass changed nothing except which branch of the code ran.
--
-- Migration 0020 removed the ability for a group to bypass the gate. So the flag on
-- these rows now describes a capability that no longer exists, attached to sends
-- where it had no effect. Leaving it would mean the send log permanently reports
-- six consent violations that did not occur — which devalues the warning on the
-- messages where it does mean something.
--
-- This is a correction, not a rewrite. The distinction that matters: the flag is
-- being cleared because the fact it asserts is not true of these sends, and that was
-- checked rather than assumed. Where a send genuinely did reach someone without
-- consent, the flag must stay.
--
-- Scoped to group audiences, which after 0020 can never bypass. Intro texts
-- (`series_intro`) still legitimately bypass and keep their flag — that is the one
-- case the warning exists for.
--
-- Safe to run after migrations 0001-0020, and safe to re-run.

update messages
set bypassed_consent_gate = false
where audience_kind = 'group'
  and bypassed_consent_gate;

-- Anything still flagged should be an intro-text send. Review the result: a group
-- send appearing here after this runs would mean something is setting the flag that
-- should not be.
select
  audience_kind,
  count(*) as messages,
  min(sent_at) as earliest,
  max(sent_at) as latest
from messages
where bypassed_consent_gate
group by audience_kind;

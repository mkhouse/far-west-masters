-- Migration 0003 — races that do not count toward season standings
--
-- Nationals is the case this exists for. It is on the FWM schedule and members are
-- texted about it, but it is scored and published by usalpinemasters.org and does
-- not count toward FWM season standings.
--
-- This is not cosmetic: best-N is calculated from races actually scored, so
-- including Nationals would change every racer's season total.
--
-- Safe to run after migrations 0001 and 0002.

alter table races
  add column counts_toward_standings boolean not null default true;

comment on column races.counts_toward_standings is
  'False for races on the FWM schedule that are scored elsewhere — Nationals in '
  'particular. Excluded from best-N and season standings, but still available for '
  'race participation and messaging.';

-- -----------------------------------------------------------------------------
-- Note on membership
--
-- FWM membership is conceptually per season, and the published award rule requires
-- entrants to be "current paid members ... for the current season". That is not
-- modelled here, deliberately.
--
-- The membership director verifies membership at registration, so **anyone who
-- appears in a race is a member for that season** and there is nothing for this
-- system to validate. Award eligibility therefore reduces to the starts count.
--
-- If membership tracking is added later, it belongs in a `memberships` table
-- (person, season, paid) rather than as a flag on `people` — a racer can lapse and
-- rejoin, and lapsed-racer outreach needs to know *when* someone stopped renewing,
-- not merely that they have. `people.status` remains an operational category for
-- messaging (officer, out-of-region racer, imported-from-registration) and is not
-- a membership record.
-- -----------------------------------------------------------------------------

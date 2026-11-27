-- Migration 0033 — 2026-2027 scoring rules
--
-- SCORES NOTHING. It fills in the rules the scoring engine reads; no standings
-- are computed by this, and no results exist yet to compute them from.
--
-- WHY THIS WAS BLANK. A season is created without scoring rules on purpose —
-- see /admin/schedule, which says so when it creates one. A rule guessed from
-- last season would produce standings that look right and are not: 2025-2026
-- had 14 races and a best-11, and 2026-2027 has 17 and a best-13.
--
-- SOURCE. The club's published rules for this season:
-- https://resources.farwestmasters.org/faq/2027/Season-Scoring-and-Open-Class.pdf
-- Quoting it directly:
--
--   "points are awarded to the top 30 finishers on a scale of
--    100, 80, 60, 50, 45, 40, ..., 1"
--   "the season standings are based on your best results in 75% of the races
--    (rounded up)"
--   "2026-2027 scoring: best 13 finishes of 17 races are counted"
--   "Racers must have at least 6 starts to qualify for a season award"
--
-- WHY 17 AND NOT 21. The schedule holds 21 races for this season; four of them
-- are the FIS Masters World Cup Finals at Big Sky Resort, already flagged
-- `counts_toward_standings = false` because they are not Far West division
-- races. 21 - 4 = 17, which is the figure the club published, and
-- ceil(0.75 x 17) = 13, which is the best-N it published. The same arithmetic
-- holds for the last verified season: ceil(0.75 x 14) = 11.
--
-- THE POINTS SCALE IS NOT COPIED FROM THE PDF, which elides the middle with
-- "...". It is `WC_POINTS_SCALE` from results-engine/src/types.ts, which was
-- measured from FWM's own published standings by
-- migration/detect-points-scale.mjs rather than assumed from the FIS scale.
-- The first six values and the depth of 30 agree with the PDF.
--
-- `min_starts_for_award` is already 6 and `age_groups` is already `five_year`;
-- both are left alone. The minimum-starts waiver for racers 70 and over, and
-- the awards committee's discretion to waive it individually, are judgements
-- this system does not model — see the note in RUNBOOK.md.

update seasons
set
  best_n = 13,
  total_races = 17,
  points_scale = array[
    100, 80, 60, 50, 45, 40, 36, 32, 29, 26,
     24, 22, 20, 18, 16, 15, 14, 13, 12, 11,
     10,  9,  8,  7,  6,  5,  4,  3,  2,  1
  ],
  rules_verified = true
where name = '2026-2027';

-- Fails loudly rather than silently doing nothing if the season is missing or
-- the race count has moved since this was written.
do $$
declare
  n int;
  counting int;
begin
  select count(*) into n from seasons
   where name = '2026-2027' and best_n = 13 and rules_verified;
  if n <> 1 then
    raise exception '2026-2027 scoring rules were not applied';
  end if;

  select count(*) into counting
    from races r join seasons s on s.id = r.season_id
   where s.name = '2026-2027' and r.counts_toward_standings;
  if counting <> 17 then
    raise exception
      'Expected 17 counting races, found %. best_n of 13 assumes 17 — recheck ceil(0.75 x races).',
      counting;
  end if;
end $$;

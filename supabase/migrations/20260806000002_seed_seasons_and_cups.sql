-- Migration 0002 — seed seasons and cups with their historical scoring rules
--
-- Every value here was measured from FWM's published results rather than taken
-- from memory; see migration/scoring-history.md for how each was derived and
-- migration/cup-rules.md for the cup differences.
--
-- This is what makes 17 years of archived results renderable under the rules that
-- actually applied at the time, instead of being silently reinterpreted under
-- today's rules.

-- -----------------------------------------------------------------------------
-- Seasons
--
-- best_n is `ceil(0.75 x races)` — FWM's published rule, "your best results in
-- 75% of the races (rounded up)" — using races actually scored, not scheduled.
-- 2021 is the one exception: covid cut it to six races and all six counted.
--
-- points_scale: top-15 scale through 2015, the 30-deep World Cup scale from 2016.
-- age_groups:   ten-year bands through 2009, five-year classes from 2010.
-- -----------------------------------------------------------------------------
insert into seasons (name, year, best_n, total_races, points_scale, age_groups, rules_verified, active)
values
  -- ten-year age groups, legacy points scale
  ('2008-2009', 2009, 15, 19, '{25,20,15,12,11,10,9,8,7,6,5,4,3,2,1}', 'ten_year',  true, false),

  -- five-year classes from 2010; legacy points scale through 2015
  ('2009-2010', 2010, 18, 24, '{25,20,15,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2010-2011', 2011, 20, 26, '{25,20,15,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2011-2012', 2012, 13, 17, '{25,20,15,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2012-2013', 2013, 18, 23, '{25,20,15,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2013-2014', 2014, 14, 18, '{25,20,15,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2014-2015', 2015, 14, 18, '{25,20,15,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),

  -- World Cup points scale from 2016, the same season Open Class replaced Open Seed
  ('2015-2016', 2016, 16, 21, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2016-2017', 2017,  9, 12, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2017-2018', 2018, 17, 22, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2018-2019', 2019, 12, 15, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2019-2020', 2020, 10, 13, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  -- covid: six races, all six counted (the formula would have given five)
  ('2020-2021', 2021,  6,  6, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2021-2022', 2022, 15, 19, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2022-2023', 2023,  3,  3, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2023-2024', 2024,  8, 10, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2024-2025', 2025, 11, 14, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, false),
  ('2025-2026', 2026, 11, 14, '{100,80,60,50,45,40,36,32,29,26,24,22,20,18,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1}', 'five_year', true, true)
on conflict (year) do nothing;

-- -----------------------------------------------------------------------------
-- Cups
--
-- The handicap rate belongs to the cup as it was run that season — it is NOT
-- derivable from the disciplines of the paired races. Verified by solving each
-- published racer's handicapped time back to a rate:
--
--   Viva Italia   0.0300 in every season
--   Bernard Cup   0.0250, except 2018 and 2020 which used 0.0300
--
-- Two all-slalom Bernard Cups (2015 and 2018) were scored at different rates,
-- which is what rules out a discipline-based rule.
--
-- Cups are created only for seasons where that cup was actually held and
-- published; races are linked separately once the schedule is imported.
-- -----------------------------------------------------------------------------
insert into cups (season_id, name, slug, scoring_method, handicap_rate)
select s.id,
       'Bernard Cup',
       'bernard-cup-' || s.year,
       'age_handicap',
       case when s.year in (2018, 2020) then 0.0300 else 0.0250 end
from seasons s
where s.year between 2010 and 2026
  and s.year not in (2021, 2025)   -- 2021 not held (covid); 2025 cancelled (weather)
on conflict (season_id, name) do nothing;

insert into cups (season_id, name, slug, scoring_method, handicap_rate)
select s.id,
       'Viva Italia',
       'viva-italia-' || s.year,
       'age_handicap',
       0.0300
from seasons s
where s.year between 2010 and 2026
  and s.year <> 2021               -- not held (covid)
on conflict (season_id, name) do nothing;

-- The McKinney Cup is decided on fastest raw combined time with no age handicap
-- at all, so it must never be scored with the handicap path.
insert into cups (season_id, name, slug, scoring_method, handicap_rate)
select s.id,
       'McKinney Cup',
       'mckinney-cup-' || s.year,
       'raw_combined',
       0.0000
from seasons s
where s.year in (2010, 2011, 2012, 2013, 2014, 2015, 2017, 2018, 2020, 2022)
on conflict (season_id, name) do nothing;

-- Migration 0011 — remember where an imported record came from
--
-- The Airtable base stays live until cutover, so the member import will be run more
-- than once. Without a stable key from the source, a second run cannot tell an
-- existing person from a new one and quietly creates 309 duplicates.
--
-- Matching on phone or name instead would be worse: both change, and both are the
-- fields most likely to have been corrected between runs — which is exactly when a
-- re-import matters most.
--
-- This also gives a way back to the original record while both systems coexist,
-- which is what makes the eventual cutover checkable rather than hopeful.
--
-- Safe to run after migrations 0001-0010.

alter table people
  add column airtable_record_id text unique;

comment on column people.airtable_record_id is
  'Source record id from the Airtable base, e.g. rec0LRoF2ev7NRpz5. Lets the import '
  'be re-run safely and each person traced back while both systems run in parallel. '
  'Null for people created directly in this system.';

create index people_airtable_idx on people (airtable_record_id)
  where airtable_record_id is not null;

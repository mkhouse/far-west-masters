-- Migration 0012 — record which source records were merged into a person
--
-- The Airtable base contains duplicate member records: ten people appear twice or
-- three times, because the AdminSkiRacing import matches on name and names vary —
-- "Seb" and "Sebastien", "Will" and "William", and a married name change from Hoy
-- to McGlashan.
--
-- Every duplicate group shares both a USSSA number and a phone number, so they are
-- unambiguously the same person. Two consequences in the current system:
--
--   * those ten people receive every bulk text twice, on the same phone
--   * consent is split — for three of them the intro text landed on one copy and
--     not the other, so they look less consented than they are
--
-- The import merges them. This column keeps the other source ids so the merge is
-- auditable and reversible, and so both systems can still be reconciled while they
-- run in parallel.
--
-- Safe to run after migrations 0001-0011.

alter table people
  add column merged_airtable_record_ids text[] not null default '{}';

comment on column people.merged_airtable_record_ids is
  'Additional Airtable record ids folded into this person during import, where the '
  'source held duplicate records for one human. The surviving id is in '
  'airtable_record_id. Empty for people with no duplicates.';

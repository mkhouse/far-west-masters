-- Migration 0004 — grant table access to service_role
--
-- The project was created with "Automatically expose new tables" disabled, which is
-- the right choice: it stops new tables being handed to the API roles by default,
-- so member phone numbers can never be exposed by forgetting a policy.
--
-- But that setting withholds privileges from **service_role** as well, not only from
-- anon and authenticated. Without an explicit grant the server-side key cannot read
-- its own tables:
--
--   permission denied for table seasons  (code 42501)
--
-- service_role is the trusted server-side identity. It already bypasses Row Level
-- Security by design, and it is the key all legitimate data access flows through, so
-- it needs full table privileges. anon and authenticated keep nothing — that is the
-- boundary that actually protects member data, and it is unchanged by this.
--
-- Applies to both Supabase API key formats. The newer secret keys (sb_secret_...)
-- and the older service_role JWT both resolve to the same `service_role` Postgres
-- role, so these grants are correct either way — confirmed by the database's own
-- error hint, which names service_role explicitly.
--
-- Safe to run more than once.

grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Tables created by future migrations get the same treatment automatically, so this
-- problem does not recur every time the schema grows.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

-- Re-assert the other half of the boundary, in case a future change is careless:
-- the browser-facing roles get nothing.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

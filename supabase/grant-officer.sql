-- Grant an officer access to the app.
--
-- Run this AFTER they have signed in once. Access is a row in `app_users`, and that
-- row references `auth.users`, which does not exist until they have requested their
-- first magic link. So the order is always:
--
--   1. they visit /sign-in and request a link, with the email you expect
--   2. they click it, and land on "Not authorized" — this is correct, not a failure
--   3. you run this
--   4. they reload
--
-- Roles:
--   admin      season setup, race schedule, user management, everything below
--   processor  import and publish results, send messages
--
-- Give `processor` unless someone genuinely needs to manage other people's access.
-- It is not about trust; it is that fewer people holding the ability to grant access
-- makes it obvious who did what when something changes.
--
-- Safe to re-run. Changes the role if they already have one.

-- ---------------------------------------------------------------------------
-- EDIT THIS LINE — the email they sign in with, and the role
-- ---------------------------------------------------------------------------
with officer as (
  select 'dtpalfini@yahoo.com'::text as email, 'admin'::app_role as role
)

insert into app_users (user_id, role, person_id)
select
  u.id,
  o.role,
  -- Link to their member record where the emails match, so the send log shows a
  -- name rather than an address. Null is survivable: the log falls back to email.
  (select p.id from people p where lower(p.email) = lower(u.email) limit 1)
from officer o
  join auth.users u on lower(u.email) = lower(o.email)
on conflict (user_id) do update
  set role      = excluded.role,
      person_id = coalesce(app_users.person_id, excluded.person_id);

-- Everyone who can use the app, and whether each is linked to a member record.
-- If the person you just granted is missing, they have not signed in yet — go back
-- to step 1 and check which email they actually used. A magic link requested with a
-- different address creates a different auth user, and this will silently match
-- nothing.
select
  u.email,
  a.role,
  case
    when a.person_id is null then 'NOT LINKED — member record has a different email'
    else p.first_name || ' ' || p.last_name
  end as member,
  u.last_sign_in_at
from app_users a
  join auth.users u on u.id = a.user_id
  left join people p on p.id = a.person_id
order by u.email;

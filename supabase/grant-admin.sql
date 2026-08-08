-- Grant yourself admin access after signing in for the first time.
--
-- Signing in and being allowed in are separate: anyone can request a magic link, so
-- access requires a row in app_users that only an admin can create. This is the
-- bootstrap for the very first admin, when there is nobody to create it for you.
--
-- Replace the email below, then run it in the Supabase SQL editor.
--
-- Not a migration — a one-off operational script. Safe to run again; it will update
-- the role rather than fail.

insert into app_users (user_id, role)
select id, 'admin'
from auth.users
where email = 'you@example.com'   -- <-- your own sign-in email goes here
on conflict (user_id) do update set role = 'admin';

-- Confirm it worked. Should return one row.
select u.email, a.role, a.created_at
from app_users a
join auth.users u on u.id = a.user_id;

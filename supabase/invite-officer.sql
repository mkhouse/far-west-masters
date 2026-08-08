-- Invite an officer.
--
-- Records the decision that this email address may use the app. The grant is
-- created automatically the first time that person signs in — they never see
-- "Not authorized", and you do not need to be around when they do it.
--
-- Works whether or not they have signed in before. Someone who already bounced off
-- "Not authorized" gets access on their next page load.
--
-- Roles:
--   admin      season setup, race schedule, user management, everything below
--   processor  import and publish results, send messages
--
-- Give `processor` unless someone genuinely needs to manage other people's access.
--
-- REVOKING: delete the row while `claimed_at` is null. Once claimed, the invitation
-- is only a record — remove the person's `app_users` row instead.
--
-- Safe to re-run. Re-inviting someone updates the role on an outstanding invitation
-- but will not silently re-open one that has already been claimed.

-- ---------------------------------------------------------------------------
-- EDIT THIS LINE — the email they will sign in with, the role, and why
-- ---------------------------------------------------------------------------
with invitation as (
  select
    'dtpalfini@yahoo.com'::text as email,
    'admin'::app_role           as role,
    'Board member, helping with membership'::text as note
)

-- `auth.uid()` is null when this runs in the SQL editor, which executes as the
-- database owner rather than as a signed-in person. The `note` column is therefore
-- the honest record of why an invitation exists — fill it in properly. When this
-- moves into an admin screen, invited_by will populate itself.
insert into app_user_invites (email, role, invited_by, note)
select lower(i.email), i.role, auth.uid(), i.note
from invitation i
on conflict (email) do update
  set role = excluded.role,
      note = excluded.note
  -- Only reopen the decision if it has not already been acted on.
  where app_user_invites.claimed_at is null;

-- Outstanding invitations: anyone who could walk in but has not yet.
select email, role, created_at, note
from app_user_invites
where claimed_at is null
order by created_at;

-- Everyone who actually has access today.
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

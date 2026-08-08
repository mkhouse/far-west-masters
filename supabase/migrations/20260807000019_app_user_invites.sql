-- Migration 0019 — decide who is allowed in before they ever show up
--
-- Until now, access could only be granted to someone who had already signed in:
-- `app_users.user_id` references `auth.users`, and that row does not exist until a
-- person requests their first magic link. So adding an officer meant telling them to
-- sign in, watching them land on "Not authorized", and then running SQL.
--
-- That is the wrong order for the situation this system exists to fix. Before a
-- season — or before going on holiday in October — an admin needs to be able to
-- decide who may send messages, without needing those people present.
--
-- So: an invitation is a grant recorded against an email address. The first time
-- that address signs in, the application converts it into a real `app_users` row.
--
-- WHAT THIS MEANS, PLAINLY: an unclaimed invitation is a standing grant to whoever
-- controls that mailbox. That is already true of magic-link sign-in — the mailbox is
-- the credential either way — but an invitation makes it a decision taken in
-- advance rather than one taken in the moment, so it deserves to be written down.
-- Revoke an unclaimed invitation by deleting the row. Once claimed, remove the
-- `app_users` row instead; deleting the invitation then achieves nothing.
--
-- Safe to run after migrations 0001-0018, and safe to re-run.

create table if not exists app_user_invites (
  -- Lowercased, because email is the match key and case must not decide access.
  email           text primary key check (email = lower(email)),
  role            app_role not null default 'processor',

  -- Who decided this, and when. An invitation is an authorization decision; it
  -- should be as answerable as a sent message.
  invited_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),

  -- Set when the invitation becomes a real grant. Claimed rows are kept rather than
  -- deleted, so the history of who was let in, by whom, survives.
  claimed_at      timestamptz,
  claimed_user_id uuid references auth.users (id) on delete set null,

  note            text
);

alter table app_user_invites enable row level security;
grant all privileges on table app_user_invites to service_role;

comment on table app_user_invites is
  'Access granted to an email address before that person has an account. Claimed by '
  'the application on their first sign-in. An unclaimed row is a standing grant to '
  'whoever controls that mailbox — delete it to revoke.';

comment on column app_user_invites.claimed_at is
  'Null means outstanding. Claimed invitations are retained deliberately: they are '
  'the record of how someone came to have access.';

-- Outstanding invitations, which is the only view an admin normally wants.
create index if not exists app_user_invites_unclaimed
  on app_user_invites (email)
  where claimed_at is null;

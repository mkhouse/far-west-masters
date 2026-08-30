-- Migration 0030 — a number an officer is willing to give to members
--
-- The new-member welcome ends "Please give me a call at {officer phone}". Filling
-- that needs a number, and the tempting answer is the one already on the officer's
-- member record: `people.phone`, which the compose screen already reads to populate
-- the reply-to picker.
--
-- That answer is wrong, and quietly so.
--
-- `people.phone` is INBOUND. It is where the club texts an officer, and where
-- migration 0005 forwards a member's reply. No member has ever seen it. Reusing it
-- here would publish a number collected for one purpose to roughly three hundred
-- people for another — and it would do it invisibly, template by template, with
-- nobody having agreed to it. If a second officer then used Mary's template
-- unchanged, it would hand out Mary's mobile.
--
-- So this is a separate field with a single meaning: the number this officer is
-- willing to give to members. Deliberately:
--
--   * NULLABLE, and left null. Not backfilled from `people.phone` — a backfill is
--     the silent republication this column exists to prevent. The officer sets it
--     themselves at /account, where their member number is offered as a suggestion
--     they confirm rather than a default they have to notice and undo.
--
--   * NEVER fallen back from. A template needing {officer phone} used by an officer
--     who has not set one does not send. It cannot: web/src/lib/templates.ts leaves
--     an unfilled placeholder in the body, and both the compose screen and the send
--     action refuse a message with a placeholder still in it. The failure is loud,
--     in front of the officer, before anything reaches a member — which is the only
--     acceptable way for this particular thing to fail.
--
--   * On `app_users`, not `people`. It is a property of holding office, not of being
--     a person. Someone who stops being membership director stops publishing a
--     number; removing their access removes it with them, and their member record —
--     including the number the club texts them on — is untouched.
--
-- Stored E.164 like every other number here, and formatted for reading when it goes
-- into a message: a member should see (530) 555-1234, not +15305551234.
--
-- Safe to run after migrations 0001-0029, and safe to re-run.

alter table app_users
  add column if not exists contact_phone text;

comment on column app_users.contact_phone is
  'E.164. The number this officer is willing to give to members, filled into the '
  '{officer phone} placeholder in message templates. Deliberately separate from '
  'people.phone, which is inbound only — where the club texts the officer and where '
  'member replies are forwarded. Never defaulted or backfilled from it: publishing a '
  'number collected for receiving to three hundred members is a decision that belongs '
  'to the person whose number it is. Null means templates needing it will not send.';

-- Who has set one. Anybody sending the new-member welcome needs a number here; the
-- rest do not, and a null is not a fault.
select
  u.email,
  a.role,
  coalesce(p.first_name || ' ' || p.last_name, '(not linked to a member)') as officer,
  case
    when a.contact_phone is not null then a.contact_phone
    else 'not set - templates needing {officer phone} will not send'
  end as contact_number
from app_users a
  join auth.users u on u.id = a.user_id
  left join people p on p.id = a.person_id
order by u.email;

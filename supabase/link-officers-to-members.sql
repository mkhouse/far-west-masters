-- Link officer accounts to their member records.
--
-- `app_users` says who may use the app. `people` holds the member record — name,
-- phone, race history. The join between them is `app_users.person_id`, and it is
-- nullable, because an officer can be granted access before anyone works out which
-- member row is theirs.
--
-- Left null, the send log falls back to the sign-in email: "sent by
-- mkhouse@mac.com" rather than "sent by Melissa House". Correct, but not what you
-- want an officer or a board member reading months later.
--
-- Matches on email. An officer whose sign-in email differs from the one in their
-- member record will not be linked — the report at the end shows exactly who, so
-- the gap is visible rather than silent.
--
-- Not a migration: it depends on who happens to have an account, which differs
-- between environments. Run it after granting anyone new access.
--
-- Safe to re-run. Only fills in blanks; never overwrites an existing link.

update app_users a
set person_id = p.id
from auth.users u
  join people p on lower(p.email) = lower(u.email)
where a.user_id = u.id
  and a.person_id is null;

-- Optional: correct the label on messages already sent.
--
-- Migration 0017 stores the sender's name on the message deliberately, so that
-- history is not rewritten when records change later. This is the one case where
-- updating it is right rather than wrong: the email and the name identify the same
-- person, so this corrects how an existing fact is displayed — it does not change
-- who sent anything.
--
-- Comment out if you would rather leave past sends exactly as they were recorded.
update messages m
set sent_by = coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), m.sent_by)
from app_users a
  join people p on p.id = a.person_id
where m.created_by = a.user_id
  and m.sent_by like '%@%';   -- only rows still showing an email

-- Who can use the app, and whether each is linked. Anyone showing "NOT LINKED"
-- will keep appearing in the send log by email.
select
  u.email,
  a.role,
  case
    when a.person_id is null then 'NOT LINKED — check the email on their member record'
    else p.first_name || ' ' || p.last_name
  end as member
from app_users a
  join auth.users u on u.id = a.user_id
  left join people p on p.id = a.person_id
order by u.email;

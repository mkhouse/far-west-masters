-- Migration 0017 — record who sent each message, readably
--
-- `messages.created_by` already holds the sending officer's auth user id, and that
-- stays: it is the unambiguous machine-readable identity. But it cannot be rendered.
-- It points into the `auth` schema, which PostgREST does not expose, so the app has
-- no way to turn that uuid into a name.
--
-- So this adds a second, human-readable form, snapshotted at send time.
--
-- Why a snapshot rather than a join through app_users -> people:
--
--   1. If a member's contact details are ever scrubbed — a deletion request, or
--      routine hygiene on someone who has left the club — a joined name would
--      disappear from the send log at exactly the moment someone is most likely to
--      be asking who sent what.
--   2. `app_users.person_id` is nullable. An officer granted access without being
--      linked to a member record would render as a bare uuid.
--   3. A send log records what was true at the time. If a name or a person link
--      changes later, history should not quietly rewrite itself.
--
-- Sending is the one irreversible thing this system does, which is the whole reason
-- the log has to answer "who" without depending on anything else still being there.
--
-- Safe to run after migrations 0001-0016, and safe to re-run.

alter table messages
  add column if not exists sent_by text;

comment on column messages.sent_by is
  'The sending officer as a human-readable label, captured at send time: their name '
  'if known, otherwise their email. Deliberately denormalised — see created_by for '
  'the authoritative identity. Survives a scrub of the linked person record.';

-- Backfill anything already sent. The SQL editor runs as a role that can read
-- auth.users; the application deliberately cannot, which is why this happens here
-- and once, rather than in the app.
--
-- Prefers the linked member's name, falls back to the login email.
update messages m
set sent_by = coalesce(
      nullif(trim(p.first_name || ' ' || p.last_name), ''),
      u.email
    )
from auth.users u
  left join app_users a on a.user_id = u.id
  left join people    p on p.id      = a.person_id
where m.created_by = u.id
  and m.sent_by is null;

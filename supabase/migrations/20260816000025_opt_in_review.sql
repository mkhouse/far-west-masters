-- Migration 0025 — reviewing opt-in submissions
--
-- Migration 0024 created `opt_in_submissions` and left unmatched ones sitting at
-- status 'pending' with nothing to surface them. This adds the two columns a review
-- needs, so the queue in /admin/opt-ins can record who decided and when.
--
-- WHY NOT REUSE linked_at / linked_by. Those mean something specific: this
-- submission was attached to that person, at that time. A rejection attaches nothing
-- and still has a reviewer and a timestamp, and a review that finds an existing
-- member sets both pairs for different reasons. Overloading the link columns would
-- make "who linked this" and "who looked at this" the same question, which they are
-- not — one is a fact about the data, the other about the process.
--
-- Safe to run after migrations 0001-0024, and safe to re-run.

alter table opt_in_submissions
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null;

comment on column opt_in_submissions.reviewed_at is
  'When an officer decided what to do with this submission. Null for anything the '
  'application linked automatically on a phone match — nobody reviewed those, and '
  'recording a review that did not happen would misrepresent the audit trail.';

comment on column opt_in_submissions.reviewed_by is
  'Who decided. Kept separately from linked_by: a rejection has a reviewer but no '
  'link, and the two answer different questions.';

-- The queue reads pending submissions oldest-first — somebody who filled in the form
-- three weeks ago has been waiting longest and should not be buried under today's.
-- Migration 0024 indexed them newest-first for the same predicate; this replaces it
-- rather than adding a second index over the same rows.
drop index if exists opt_in_submissions_pending;

create index if not exists opt_in_submissions_pending
  on opt_in_submissions (created_at asc)
  where status = 'pending';

-- A reviewed submission should never sit at 'pending', and a pending one should
-- never claim to have been reviewed. Enforced here rather than trusted to the
-- application, because the review queue is exactly the place where a half-finished
-- action would otherwise leave a row that no screen ever shows again.
alter table opt_in_submissions
  drop constraint if exists opt_in_submissions_review_consistent;

alter table opt_in_submissions
  add constraint opt_in_submissions_review_consistent
  check (
    (status = 'pending' and reviewed_at is null)
    or (status <> 'pending')
  );

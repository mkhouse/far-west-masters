-- Migration 0024 — opt-in form submissions
--
-- The public opt-in form, replacing the Airtable one. This is the only place in the
-- system where a stranger can write anything, so the shape matters.
--
-- SUBMISSIONS ARE NOT PEOPLE. They land in their own table and are matched to a
-- member afterwards. Somebody typing a name into a public form must not be able to
-- create or alter a member record — that is how a club ends up with fifteen
-- duplicate people, each receiving every text twice, which is exactly what happened
-- in Airtable.
--
-- WHAT HAPPENS ON SUBMISSION (Melissa, 2026-08-12):
--
--   * The phone number matches an existing member — any membership status: link
--     them, record consent, and send the intro text immediately. The form promises
--     "you will receive an introductory SMS message shortly after you complete this
--     form", so a manual step would break a promise made to the member.
--
--   * No match: hold as pending for the review queue. Nothing is created, nothing
--     is sent. An unmatched submission is a question for a human — which is what
--     #21 exists to answer.
--
-- Note what the match requirement quietly buys: the only way this form can cause a
-- text to be sent is to a phone number already in the member database. It cannot be
-- used to send a message to an arbitrary number.
--
-- Safe to run after migrations 0001-0023, and safe to re-run.

create table if not exists opt_in_submissions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  -- Exactly the fields the Airtable form collected, plus an optional USSA number.
  -- That number is what made roster matching succeed for every entrant, so asking
  -- for it here fills the gap at source rather than chasing it later.
  first_name   text not null,
  last_name    text not null,
  email        text not null,
  usssa        bigint,

  -- Both forms of the phone: what they typed, and what we made of it. Keeping the
  -- raw value means a normalisation bug can be found and re-run later, rather than
  -- having quietly destroyed the only copy.
  phone_raw    text not null,
  phone        text,

  -- The consent checkbox. Stored rather than assumed: this row is the evidence that
  -- a specific person agreed, on a specific date, to receive texts.
  consented    boolean not null,

  -- pending -> linked, or pending -> rejected. Nothing is deleted; a rejected
  -- submission is part of the record of what was decided.
  status       text not null default 'pending'
                 check (status in ('pending', 'linked', 'rejected')),

  person_id    uuid references people (id) on delete set null,
  linked_at    timestamptz,
  -- Null when the application linked it automatically on a phone match; set when a
  -- person made the decision in the review queue.
  linked_by    uuid references auth.users (id) on delete set null,
  match_method text check (match_method in ('phone', 'manual', 'created')),

  note         text
);

alter table opt_in_submissions enable row level security;
grant all privileges on table opt_in_submissions to service_role;

comment on table opt_in_submissions is
  'Public opt-in form submissions. Deliberately separate from people: a submission '
  'is a claim, not a member record, and becomes one only when matched.';

comment on column opt_in_submissions.phone_raw is
  'Exactly what was typed. Kept alongside the normalised form so a normalisation '
  'mistake can be corrected later rather than having destroyed the evidence.';

comment on column opt_in_submissions.consented is
  'The consent checkbox. This row is the evidence that a named person agreed on a '
  'given date to receive texts — worth being able to produce if ever asked.';

-- The review queue reads pending submissions constantly and everything else rarely.
create index if not exists opt_in_submissions_pending
  on opt_in_submissions (created_at desc)
  where status = 'pending';

-- Matching is by normalised phone, so that lookup should be quick.
create index if not exists opt_in_submissions_phone
  on opt_in_submissions (phone);

-- The consent wording, kept where an admin can change it without a deploy. Taken
-- verbatim from the Airtable form so that what members agree to does not silently
-- change when the form moves.
insert into app_settings (key, value, description) values
  (
    'opt_in_consent_label',
    'By checking this box, I consent to opt-in to Far West Masters SMS messaging.',
    'The consent checkbox label on the public opt-in form. Should match what was '
    'described to Twilio when the toll-free number was verified — if this changes, '
    'check the two still agree.'
  ),
  (
    'opt_in_intro_promise',
    'You will receive an introductory SMS message from Far West Masters shortly after you complete this form.',
    'The promise the form makes about the intro text. The application sends that '
    'text automatically on a phone match, which is what keeps this true.'
  )
on conflict (key) do nothing;

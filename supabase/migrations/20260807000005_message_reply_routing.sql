-- Migration 0005 — reply routing and reply expectations for outbound messages
--
-- Three related needs:
--
--   1. Different kinds of message should be answered by different people. Racing
--      questions go to the race chair, membership questions to the membership
--      director.
--   2. Some messages — race-day announcements in particular — go out when nobody is
--      in a position to answer. Nobody's phone should buzz for those.
--   3. Recipients should be told when replies will not be answered.
--
-- Note what is NOT possible: SMS has no reply-to header, and true one-way sending
-- (alphanumeric sender ID) is unavailable in the US and Canada. A recipient can
-- always text back. So this models *where a reply goes* and *whether anyone is
-- watching*, not whether replying is possible.
--
-- Safe to run after migrations 0001-0004.

-- Message category, used to pick a default reply contact and for reporting.
create type message_category as enum (
  'race',        -- race announcements, start times, conditions
  'membership',  -- renewals, sign-ups, member admin
  'general',     -- newsletters, social, everything else
  'intro'        -- the consent/intro text that unlocks bulk messaging
);

alter table messages
  add column category message_category not null default 'general',

  -- Where replies to this message are forwarded, in E.164. Null means fall back to
  -- SMS_FORWARD_TO_NUMBER. Chosen per message from the compose form, so a race
  -- announcement can route to the race chair and a renewal notice to the membership
  -- director.
  --
  -- The number is captured at send time rather than resolved later: the right
  -- contact is a property of the message as sent, so reassigning an officer next
  -- season must not silently re-route last season's replies.
  add column reply_forward_to text,

  -- Who that number belonged to, for display in the log and the compose form. The
  -- number above stays the operative value — same pattern as message_recipients,
  -- where the phone is snapshotted so history survives a contact detail changing.
  add column reply_forward_person_id uuid references people (id) on delete set null,

  -- False for messages sent when nobody is watching (on the hill on race day).
  -- Replies are still received and logged; they are simply not forwarded, and the
  -- sender gets one automatic acknowledgement.
  add column replies_monitored boolean not null default true,

  -- Appended to the body at send time. Null with replies_monitored = false means
  -- use the configured default; set it to override the wording for one message.
  --
  -- IMPORTANT: this text counts toward the 160-character SMS segment limit. The
  -- composer must calculate segments from body + notice, not the body alone —
  -- otherwise a message that looks like one segment silently bills as two for every
  -- recipient.
  add column reply_notice text;

comment on column messages.replies_monitored is
  'False suppresses forwarding of replies and triggers a single auto-acknowledgement. '
  'Replies are still received and logged. STOP is always honoured regardless.';

-- -----------------------------------------------------------------------------
-- Inbound replies: record what happened to them
-- -----------------------------------------------------------------------------
alter table inbound_messages
  -- Which outbound message this appears to answer — the most recent one sent to
  -- that number. Determines who the reply is forwarded to.
  add column in_reply_to_message_id uuid references messages (id) on delete set null,

  -- Null when forwarding was deliberately suppressed, distinguishing "we chose not
  -- to forward this" from "forwarding failed".
  add column forward_suppressed boolean not null default false,

  -- Whether the automatic "replies are not monitored" acknowledgement was sent, so
  -- a person texting several times only receives it once.
  add column auto_replied_at timestamptz;

comment on column inbound_messages.in_reply_to_message_id is
  'Best-effort: the most recent outbound message to this number. A reply arriving '
  'days later may attribute to a newer message than the sender intended.';

-- -----------------------------------------------------------------------------
-- Default reply contact per category
--
-- The compose form offers a picker of officers, and pre-selects whoever normally
-- handles that kind of message: racing questions to the race chair, membership
-- questions to the membership director.
--
-- Pre-filling matters more than it sounds. The person composing a race-day
-- announcement is at a venue, on a phone, in a hurry — a field they must remember
-- to set is a field that will sometimes be wrong, and a wrong reply contact fails
-- silently, with replies going to someone who is not expecting them.
--
-- Still overridable per message; this only decides what the form starts with.
-- -----------------------------------------------------------------------------
create table category_reply_defaults (
  category   message_category primary key,
  person_id  uuid not null references people (id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table category_reply_defaults enable row level security;
grant all privileges on table category_reply_defaults to service_role;

comment on table category_reply_defaults is
  'Which officer normally fields replies for each message category. Pre-selects the '
  'reply contact in the compose form; the sender can still change it.';

-- The picker itself reads from `people`: officers who have a phone number.
-- No separate contacts list to keep in step with the member records.
comment on column messages.reply_forward_person_id is
  'The officer chosen in the compose form. Sourced from people where status = '
  '''officer'' and phone is not null.';

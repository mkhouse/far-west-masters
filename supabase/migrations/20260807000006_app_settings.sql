-- Migration 0006 — operational settings an admin can change
--
-- Values that are policy rather than logic: message length limits, the default
-- reply notice, the length of Twilio's opt-out append.
--
-- These live in the database rather than in code or environment variables so an
-- admin can change them without a developer and without a deploy. That is the whole
-- point of this project — a system that needs one specific person to adjust a number
-- has the problem it was built to avoid.
--
-- Safe to run after migrations 0001-0005.

create table app_settings (
  key         text primary key,
  value       text not null,
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

alter table app_settings enable row level security;
grant all privileges on table app_settings to service_role;

comment on table app_settings is
  'Operational policy an admin can change without a deploy. Not for secrets — those '
  'stay in environment variables.';

insert into app_settings (key, value, description) values
  (
    'sms_warn_segments',
    '2',
    'Warn the sender when a message exceeds this many SMS segments. FWM messages '
    'routinely run to 2-3 segments and that is accepted; the warning marks the point '
    'where the cost is worth a second look, not an error.'
  ),
  (
    'sms_max_segments',
    '3',
    'Refuse to send a message longer than this many segments. Every extra segment is '
    'billed per recipient, so at ~300 members a fourth segment is 300 extra messages. '
    'Raise deliberately if a genuinely longer message is needed.'
  ),
  (
    'sms_optout_append_length',
    '18',
    'Characters Twilio adds to every message for opt-out language ("Text STOP to '
    'stop" plus a separator). Appended after the app hands off the message, so the '
    'composer must subtract it to count segments correctly. If this is changed in the '
    'Twilio console, change it here too.'
  ),
  (
    'sms_default_reply_notice',
    'Replies not monitored.',
    'Appended to messages marked as not monitored, unless the sender overrides it. '
    'Counts toward the character budget, so shorter is better.'
  )
on conflict (key) do nothing;

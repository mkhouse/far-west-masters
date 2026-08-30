-- Migration 0029 — the eight templates FWM actually uses
--
-- These are Mary's own messages, taken from what she sends today, with the personal
-- details replaced by placeholders. Nothing here is invented wording: the redaction
-- this public repository needs and the thing that turns a message into a template are
-- the same edit. See docs/message-templates.md for where each one came from.
--
-- THREE CHANGES FROM WHAT SHE TYPED, all deliberate:
--
--   1. Curly apostrophes straightened. "don't" and "can't" arrived carrying U+2019,
--      inserted by a Mac or an iPhone and invisible on screen. It forces UCS-2 and
--      cuts a segment from 160 characters to 70 — the short-term licence message
--      costs 3 segments as typed and 2 once straightened, and the racer profile one
--      costs 5 and 2. Every use, forever, for a character nobody can see.
--
--   2. The em dash in the racer-profile message replaced with a hyphen, for exactly
--      the same reason. It is not an apostrophe but it is the same trap.
--
--   3. The re-engagement message names TWO races — "racing at X next weekend? Or Y
--      the following weekend?" — so its second venue is {next venue} rather than a
--      second {venue}. One placeholder filled once would put the same resort in both
--      halves of the sentence and turn an opening into nonsense. This is the only
--      placeholder not listed in docs/message-templates.md, and it is here because
--      the real message needs it.
--
-- Note that the course-inspection and event-waiver messages have no {first name} in
-- them. They answer a question or issue an instruction rather than opening a
-- conversation, and that is why the editor does not insist a template address
-- anybody.
--
-- THE EVENT WAIVER MESSAGE is the newest of the eight and the odd one out in three
-- ways, all of them kept rather than tidied away:
--
--   * It is a numbered route through somebody else's website, so it is the first
--     template with line breaks in it. Newlines are ordinary GSM-7 characters costing
--     one each; the message is 227 characters and two segments including the opt-out
--     line, so the layout is free. Keep the steps on separate lines — run together
--     into a paragraph this becomes unusable on a phone, which is the only place it
--     is ever read.
--
--   * "DP" in the original is Diamond Peak. Made {venue}, because the identical
--     instructions apply to every race that needs a waiver and the abbreviation is
--     one only insiders can expand.
--
--   * It opens "Good morning", which is true when Mary sends it and wrong by the
--     afternoon. Left exactly as she wrote it — this file records what the club
--     actually says — but it is the one line in these eight worth an officer's eye
--     before pressing send.
--
-- "masters.adminskiracing" is also as typed, without a TLD. It reads as an
-- instruction rather than a link, and correcting it would be inventing wording.
--
-- Safe to run after migration 0028, and safe to re-run — matching live names are
-- left alone, so an edited template is never reverted by re-running this.

insert into message_templates (name, category, body)
select v.name, v.category::template_category, v.body
from (values

  ('New member welcome',
   'new_member',
   'Hello {first name}, this is {officer name} from Far West Masters membership checking in with you as a new member. Please give me a call at {officer phone}'),

  ('Bib pickup',
   'race_logistics',
   'Hi {first name}, meet me between {time} at {venue} Competition Services office on the upper level of the base village to pick up your new FWM bib.'),

  ('Course inspection and start times',
   'race_logistics',
   'Usually there is course inspection shortly after the lifts open (need to take two lifts to get to the start of the {venue} race course). The races usually start around 10ish by age group (older men/women, then rest of women & finally men by 5 yr age groups)'),

  ('Short-term licence',
   'action_required',
   'Hello {first name}, just sent you an email to get your short-term license. Take action ASAP so we don''t have an issue race day (can''t race without this license). Check spam if you don''t see it.'),

  ('Racer profile - credit card',
   'action_required',
   'Hi {first name}, this is {officer name} from FWM membership - you need to enter your credit card information in your racer profile. Note you don''t get charged for a race until the day after racing. We need to have a sense of numbers, and other times Mother Nature cancels the race for us.'),

  -- Line breaks are real newlines, not an accident of formatting this file. This is a
  -- route through somebody else's website and it is read on a phone; run together
  -- into a paragraph it stops being followable. They cost one GSM-7 character each.
  ('Event waiver',
   'action_required',
   'Good morning, good to see you signed up for {venue}. Reminder you need to sign their waiver/release.

Go to your account in masters.adminskiracing
Left margin go to Event Sign-up
Click Far West
Waiver should be first option for you'),

  ('Checking in',
   're_engagement',
   'Hope all is well with you. This is {officer name} from FWM membership checking in with you. Any thoughts about racing at {venue} next weekend? Or {next venue} the following weekend?'),

  ('When race notices go out',
   'question',
   'Hi {first name}, this is {officer name} from FWM responding to your question. Generally we start sending notices out to members in late September/early October when we have a final ski race schedule. Ski resorts have limited race dept staff during summer.')

) as v(name, category, body)
where not exists (
  select 1 from message_templates t
  where lower(t.name) = lower(v.name)
    and t.archived_at is null
);

-- Check what landed. The encoding column is the one worth reading: anything other
-- than "plain ASCII" means a character has crept back in that will cut every segment
-- of that template from 160 characters to 70.
--
-- Character counts are of the stored body. The message that actually goes out is
-- longer — placeholders fill to real names and venues, and the app appends the
-- opt-out line — so treat these as a floor rather than the final cost.
select
  name,
  length(body) as characters,
  case
    when body ~ '[^\x20-\x7E\n]' then 'CONTAINS NON-ASCII - check it'
    else 'plain ASCII'
  end as encoding
from message_templates
where archived_at is null
order by category, name;

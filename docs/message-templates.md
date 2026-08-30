# Message templates — design notes

Written 2026-08-16 from seven real templates Mary uses today. Input for tasks **#54**
(saved templates) and **#55** (the outreach list an officer works through).

**Nothing here is invented.** The wording below is Mary's, with the personal details
replaced by placeholders — which is both the redaction this public repo needs and
exactly what turns a message into a template.

---

## What the real messages show

**They are personal, one-to-one, and named.** Every message addressed to a member
opens with their first name. A template is therefore never fixed text; it is text
with blanks, filled when an officer picks a person off the outreach list.

**The officer identifies herself in five of the seven.** "This is Mary from FWM
membership." She has to: the message arrives on the member's phone from an unknown
personal number, so without it the first question is "who is this?". Templates are
shared between officers, so this cannot be hardcoded — it has to be filled from
whoever is signed in.

**One gives out a personal mobile number.** If another officer used that template
unchanged, it would hand out Mary's number. Same fix: a placeholder, filled from the
officer's own record. **This means officers need a contact number on their record**,
which nothing currently collects — see the open questions below.

**Two of them are secretly expensive.** They contain a curly apostrophe in "don't",
inserted automatically by a Mac or iPhone and invisible on screen. That forces UCS-2
and cuts a segment from 160 characters to 70:

| Template | As typed | After cleaning |
|---|---|---|
| Racer profile / credit card | **5 segments** | 2 |
| Short-term licence | 3 segments | 2 |

Sent from an officer's own phone this costs nothing. Sent through the app to a group
it is two and a half times the bill for a character nobody can see. The compose screen
already fixes this on the way in (`fixSmartCharacters`); **the template editor must do
the same on save**, or a template becomes a permanent 2.5x multiplier.

**Length, for reference:** 133–264 characters. Only two fit in a single segment. Most
are two. That is fine — these are read by one person, not blasted to three hundred —
but the editor should *show* the segment count rather than refuse a long one, because
a template written for a personal text has no segment budget at all.

---

## Placeholders needed

| Placeholder | Filled from | Why |
|---|---|---|
| `{first name}` | the member being contacted | Every addressed message uses it |
| `{officer name}` | the signed-in officer | "This is Mary from FWM" — shared templates cannot hardcode a name |
| `{officer phone}` | the signed-in officer's record | So a template does not hand out someone else's mobile |
| `{venue}` | the race | Bib pickup and course inspection are venue-specific |
| `{time}` | the race | "meet me between 7:30-8:30" |

---

## The five kinds

Roughly the category list a template picker should offer.

### 1. New member welcome

> Hello {first name}, this is {officer name} from Far West Masters membership checking
> in with you as a new member. Please give me a call at {officer phone}

This is the message behind #57's finding that the membership director already contacts
every new member by hand. #55 is tooling for a job that is already being done.

### 2. Race-day logistics

> Hi {first name}, meet me between {time} at {venue} Competition Services office on the
> upper level of the base village to pick up your new FWM bib.

> Usually there is course inspection shortly after the lifts open (need to take two
> lifts to get to the start of the {venue} race course). The races usually start around
> 10ish by age group (older men/women, then rest of women & finally men by 5 yr age
> groups)

The second has no name in it — it answers a question rather than opening a
conversation. So **not every template needs `{first name}`**, and the editor must not
insist on one.

### 3. Action required before race day

> Hello {first name}, just sent you an email to get your short-term license. Take
> action ASAP so we don't have an issue race day (can't race without this license).
> Check spam if you don't see it.

> Hi {first name}, this is {officer name} from FWM membership — you need to enter your
> credit card information in your racer profile. Note you don't get charged for a race
> until the day after racing. We need to have a sense of numbers, and other times
> Mother Nature cancels the race for us.

Both of these are the ones carrying the curly apostrophe. Straightened here.

### 4. Re-engagement

> Hope all is well with you. This is {officer name} from FWM membership checking in
> with you. Any thoughts about racing at {venue} next weekend? Or {venue} the following
> weekend?

This is the template #9 feeds: a racer who has stopped showing up. Worth noting it
names two upcoming races rather than one — an opening, not a summons.

### 5. Answering a question

> Hi {first name}, this is {officer name} from FWM responding to your question.
> Generally we start sending notices out to members in late September/early October
> when we have a final ski race schedule. Ski resorts have limited race dept staff
> during summer.

---

## Open questions

**Officers have no phone number on record.** `{officer phone}` needs somewhere to come
from. `app_users` links to a person, and that person has a phone — but it is the number
they receive club texts on, which may not be the one they want members calling. Worth
asking before assuming.

**Should the officer's name be their full name or first name?** Mary writes "this is
Mary". The member record holds both.

**Do venue and time come from the race schedule, or are they typed?** The schedule is
not built yet (#6). Typed for now, and worth revisiting.

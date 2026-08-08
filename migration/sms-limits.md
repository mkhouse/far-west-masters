# SMS length, segments, and what they cost

Everything the compose screen has to get right about message length. Getting this
wrong is not a crash — it is a quietly doubled bill, every recipient, every send.

## Segments, not characters

SMS is billed per **segment**, not per message. A message longer than one segment is
split, sent as several messages, and billed as several — multiplied by every
recipient. At ~300 recipients, one careless character costs 300 extra sends.

| Encoding | First segment | Each segment when split |
|---|---:|---:|
| **GSM-7** (plain text) | 160 | 153 |
| **UCS-2** (any special character) | **70** | 67 |

Split messages carry a header, which is why the per-segment limit drops once a
message no longer fits in one.

## The UCS-2 cliff — the one that catches people

A single character outside the GSM-7 alphabet forces the **entire message** into
UCS-2, and the limit collapses from 160 to **70**.

The usual culprits are invisible, because word processors and phones insert them
automatically:

| Looks like | Actually is | In GSM-7? |
|---|---|---|
| `'` curly apostrophe | U+2019 | **No** |
| `"` `"` curly quotes | U+201C / U+201D | **No** |
| `—` em dash, `–` en dash | U+2014 / U+2013 | **No** |
| `…` ellipsis | U+2026 | **No** |
| emoji, accented letters | various | **No** |

So `Don't forget` (typed in a word processor with a curly apostrophe) costs 70
characters of headroom versus `Don't forget` typed plainly. Same visible text.

**The composer fixes these automatically as text is typed or pasted**, replacing
smart punctuation with plain equivalents and noting what changed. Applied rather than
offered, for two reasons: the correction happens in the compose box so the sender
sees exactly what will be sent, and a prompt would not be actionable anyway — the
offending character is invisible, so "find and fix it yourself" is not a request
anyone can act on.

Only punctuation is substituted. Letters are never touched, so member names survive
intact — and the common accented characters (`é ü ñ ö à ä å æ ß Ç Ø`) are already in
GSM-7, so they neither trigger the cliff nor get rewritten.

Note that `…` becomes `...`, which is two characters *longer*. Still worth it: the
ellipsis alone would force UCS-2 and cut the budget by more than half.

## FWM's actual budget

Opt-out language goes on **every** message. Consistent opt-out language supports
sender reputation with carriers, and FWM treats it as policy, not decoration.

```
Text STOP to stop        17 characters, plus a newline separator = 18
```

**The app appends this, not Twilio.** That was originally assumed to be Twilio's
job, at the Messaging Service level, and it was wrong — see "How we found this out"
below. The wording lives in `app_settings.sms_optout_text`, and `composeBody()` in
`web/src/lib/sms/segments.ts` adds it, last, on its own line, after any reply notice.

| | GSM-7 | UCS-2 |
|---|---:|---:|
| Segment limit | 160 | 70 |
| Less the opt-out line | −18 | −18 |
| **Usable for the message body** | **142** | **52** |

If a reply notice is also appended (see migration 0005), subtract that too — a
22-character notice leaves **119** GSM-7 characters. Worth asking, for each
unmonitored message, whether the notice earns its place.

## FWM's segment policy

Most FWM messages run to two or three segments. That is known and accepted — the
club would rather send a clear message than a cryptic one.

| Segments | Behaviour |
|---|---|
| 1 – 2 | Normal. No warning. |
| 3 | **Warn**, do not block. Show the total message count. |
| 4+ | **Refuse to send.** |

The thresholds are `sms_warn_segments` and `sms_max_segments` in `app_settings`, so
an admin can change them without a deploy. The ceiling exists because cost scales
with recipients: at ~300 members a fourth segment is 300 extra messages, and that is
worth a deliberate decision rather than an accident.

### Character budget by segment count

GSM-7, after subtracting the 18-character opt-out line:

| Segments | Raw limit | Usable for the body |
|---:|---:|---:|
| 1 | 160 | **142** |
| 2 | 306 | **288** |
| 3 | 459 | **441** |

In UCS-2 the same three tiers give **52**, **116** and **183** characters — which is
why the encoding warning matters more than the length one.

## Emoji and accented characters

Both are **allowed**. Neither is stripped or substituted — rewriting a member's name
to save characters would be worse than sending a shorter message.

They are not free, though. Any character outside GSM-7 forces the whole message into
UCS-2, so a single emoji cuts the per-segment limit from 160 characters to 70. The
composer shows this as a reduced budget with the reason, rather than as an error.

**Emoji are capped at three per message** (`sms_max_emoji`). That limit is about tone
and carrier reputation rather than cost — three reads as friendly, fifteen reads as
spam. Typographic symbols such as `©` and `™` are not counted as emoji, though they
do still force UCS-2.

Two counts that deliberately differ:

- **Emoji count** is by grapheme, as a reader sees it — a multi-part emoji like a
  family is one emoji.
- **Budget cost** is by UTF-16 code unit — `⛷` costs one character, `🎿` costs two,
  and a multi-part emoji can cost six or more.

Mixing these up would produce a cap that behaves unpredictably.

## What the compose screen must do

1. **Count the real total**: body + reply notice + opt-out line — not what was
   typed. Better still, count the assembled message, which is what the composer
   does: `additionsLength()` measures `composeBody()` rather than guessing.
2. **Show segments and recipients together.** "3 segments × 287 recipients = 861
   messages" is the number that matters. A character count alone hides the cost.
3. **Fix smart punctuation automatically** as text is entered, and say so quietly.
4. **Explain a reduced budget rather than forbidding the cause.** When an emoji or
   accent forces UCS-2, name the character and show the smaller limit — do not treat
   it as an error.
5. **Warn above two segments; refuse above three, or above three emoji.** The
   warning is informational — three segments is a normal, allowed choice. The
   refusals are the guard rails.

## How we found this out

The first test message sent by the new system arrived **without** the opt-out line.
Every message the old Airtable app had sent carried it. So Airtable had been adding
it all along, and Twilio never was.

Two things had been quietly wrong, and neither would have announced itself:

- FWM's messages would have gone out with no opt-out language, weakening exactly the
  carrier reputation the policy exists to protect.
- The composer was reserving 18 characters for text nobody was adding, so every
  message had 18 fewer characters than it really had.

The fix was to stop assuming and make the app own it. Two consequences worth keeping:

1. **Store the text, not its length.** `sms_optout_text` holds the wording, and the
   budget is derived from it. A number kept in step with a string by hand is a number
   that eventually is not.
2. **Compose and count with the same function.** The failure mode in an SMS system is
   not a miscount — it is the counter and the composer disagreeing, so that what was
   measured is not what was sent. `additionsLength()` is defined as the length of
   `composeBody()`, so they cannot drift.

**If Twilio is ever configured to append opt-out language itself** — a Messaging
Service with that feature switched on — set `sms_optout_text` to an empty string.
Otherwise members receive the line twice. The composer handles the other direction
already: an opt-out line the sender typed themselves is not duplicated.

The general lesson, which applies beyond this file: when behaviour depends on
configuration in a service someone else administers, verify it against a real
message rather than against the documentation.

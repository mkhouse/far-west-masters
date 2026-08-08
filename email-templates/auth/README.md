# Authentication emails

`sign-in-link.html` is the email an officer receives when they request a sign-in
link. It is not sent by this application — Supabase sends it — so it lives here as
the source of truth and is pasted into the Supabase dashboard.

## Where it goes

Supabase → Authentication → Emails → **Email Templates**.

Paste the same HTML into **both**:

| Template | Who gets it |
|---|---|
| **Magic Link** | Anyone who has signed in before |
| **Confirm signup** | Anyone signing in for the very first time |

Both, because the app calls `signInWithOtp` with `shouldCreateUser: true` — officers
are invited rather than signing themselves up, so a first-time officer is created on
first sign-in and receives the *signup* template. Updating only "Magic Link" leaves
every new officer with Supabase's default text, which is exactly the person least
equipped to recognise it as legitimate.

Subject line for both:

```
Your Far West Masters sign-in link
```

## Editing it

Keep `{{ .ConfirmationURL }}` exactly as written, in both places it appears — the
button and the plain-text fallback. Supabase substitutes it when sending.

Branding follows `../examples/` — navy `#003366`, burgundy `#8b0000`, Arial, 600px
table layout with Outlook conditionals. `deadline-reminder.html` is the closest
sibling: one message, one button.

## What is deliberately absent

- **No "view in browser" link.** There is no web version, and a link labelled that
  in an authentication email is the shape of a phishing lure.
- **No unsubscribe link.** This is transactional. You cannot unsubscribe from your
  own sign-in link, and offering it would either mislead or lock someone out of the
  only route back in.
- **No mention of what the recipient can do once inside.** The email is proof of
  address, not an announcement.

## Why it says what it says

An unexpected "click here to sign in" email is indistinguishable in form from a
phishing attempt, and the people receiving this are volunteer club officers, not
security professionals. So it names the club, says plainly what the system is, shows
the destination address in full so it can be read before clicking, and states that
ignoring it is safe. Someone who did not request it should be able to decide that in
five seconds without asking anyone.

The note about opening it in the browser you want to stay signed in on is there
because that failure is common and baffling: tapping a link from a mail app can open
it in a separate in-app browser, leaving you signed in somewhere you will never look
again.

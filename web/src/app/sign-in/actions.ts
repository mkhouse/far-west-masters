'use server'

import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'
import { signInErrorMessage } from '@/lib/sign-in-errors'

/**
 * Send a magic-link sign-in email.
 *
 * Note the deliberate lack of feedback about whether the address is registered: the
 * confirmation page says the same thing either way. Telling a stranger "no such
 * user" would turn this form into a way to discover which of the club's officers
 * have accounts.
 *
 * Requires custom SMTP to be configured in Supabase. The built-in sender is rate
 * limited to a few messages per hour and is not usable for real sign-ins.
 */
export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()

  // The form still posts a `next` field, and it is deliberately not read here: it
  // cannot be carried through the magic link. See the emailRedirectTo comment below
  // for why, and where officers land instead.

  if (!email) {
    redirect(`/sign-in?error=${encodeURIComponent('Enter an email address.')}`)
  }

  const supabase = await supabaseServer()
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // No query string here, deliberately.
      //
      // Supabase matches this against its Redirect URLs allow list as a whole
      // string, and an entry of ".../auth/callback" does not match
      // ".../auth/callback?next=/messages" — nor does a "/**" wildcard, which
      // covers path segments rather than a query. On a mismatch it silently falls
      // back to the project's Site URL, so the code arrives at the site root and
      // never reaches the one route that can exchange it. The failure looks like an
      // expired link, which sends you looking in entirely the wrong place.
      //
      // Where the officer was headed is not worth that. The app has one destination
      // after sign-in; the callback sends them to /messages.
      emailRedirectTo: `${siteUrl}/auth/callback`,
      // Officers are invited by an admin, so there is no self-service signup.
      shouldCreateUser: true,
    },
  })

  if (error) {
    // Surface transport failures (misconfigured SMTP, rate limits) rather than
    // claiming success — those are operator problems worth seeing.
    //
    // But only when Supabase says something. It does not always: when the mailbox
    // password changed on 2 November 2026 the message came back as the literal
    // string "{}", and the page rendered a red "{}" with no other clue. The real
    // cause, `535 "5.7.8 Error: authentication failed"`, was in Supabase's auth logs
    // and nowhere else. See lib/sign-in-errors.ts.
    //
    // The raw error goes to the server log either way, so the detail is recoverable
    // from Vercel without going to Supabase — and without printing SMTP internals
    // onto a page anyone can load.
    console.error('[sign-in] magic link failed', {
      code: error.code,
      status: error.status,
      message: error.message,
    })

    redirect(`/sign-in?error=${encodeURIComponent(signInErrorMessage(error.message))}`)
  }

  redirect('/sign-in?sent=1')
}

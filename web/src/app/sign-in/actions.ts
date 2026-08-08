'use server'

import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'

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
  const next = String(formData.get('next') ?? '/')

  if (!email) {
    redirect(`/sign-in?error=${encodeURIComponent('Enter an email address.')}`)
  }

  const supabase = await supabaseServer()
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      // Officers are invited by an admin, so there is no self-service signup.
      shouldCreateUser: true,
    },
  })

  if (error) {
    // Surface transport failures (misconfigured SMTP, rate limits) rather than
    // claiming success — those are operator problems worth seeing.
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/sign-in?sent=1')
}

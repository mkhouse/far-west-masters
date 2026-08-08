/**
 * Magic-link callback.
 *
 * Supabase redirects here with a one-time code after the officer clicks the link in
 * their email. Exchanging it sets the session cookie.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')

  // Only ever redirect to a path on this site. Taking the `next` parameter at face
  // value would let a crafted sign-in link bounce someone to another domain
  // immediately after authenticating.
  // Defaults to /messages rather than "/": the sign-in email no longer carries a
  // `next` (see sign-in/actions.ts), and "/" only redirects here anyway.
  const requested = searchParams.get('next') ?? '/messages'
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=Missing+sign-in+code`)
  }

  const supabase = await supabaseServer()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Usually an expired or already-used link — both are normal and worth saying
    // plainly rather than showing a generic failure.
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent('That sign-in link has expired or was already used. Request another.')}`
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}

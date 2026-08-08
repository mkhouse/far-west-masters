/**
 * Sign out.
 *
 * POST only, deliberately. A GET route would be triggerable by anything that
 * fetches a URL — a link in an email, a browser prefetch, an image tag on another
 * site — which turns signing someone out into something any page can do to them.
 * Harmless as pranks go, but it is the same shape as a real CSRF hole, and the fix
 * costs nothing.
 *
 * Clears the Supabase session cookies, then sends the officer to the sign-in page.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await supabaseServer()

  // Revokes the refresh token server-side as well as clearing cookies, so a copied
  // session cannot outlive the sign-out.
  await supabase.auth.signOut()

  // Built from the request rather than NEXT_PUBLIC_SITE_URL: this only ever needs
  // to return the officer to where they already are, and it should keep working on
  // a preview deployment or localhost without configuration.
  return NextResponse.redirect(new URL('/sign-in?signed_out=1', request.url), {
    // 303 turns the POST into a GET for the redirect, which is what a browser
    // needs here — otherwise it tries to POST to the sign-in page.
    status: 303,
  })
}

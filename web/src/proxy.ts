/**
 * Session refresh and route protection.
 *
 * Next.js 16 renamed this convention from `middleware` to `proxy`; the behaviour is
 * unchanged. It still runs before every matched request.
 *
 * Two jobs:
 *
 * 1. **Keep the session alive.** Supabase auth tokens expire, and Server Components
 *    cannot write cookies. Middleware runs before them and can, so refreshing here
 *    is what stops officers being silently logged out mid-task.
 *
 * 2. **Gate the officer areas.** Anything under /admin, /process or /messages
 *    requires a signed-in user.
 *
 * Note what this deliberately does NOT do: decide whether someone is *authorized*.
 * Middleware only establishes that a valid session exists. Roles are checked in the
 * server code that actually touches data (see lib/auth.ts), because that is where a
 * missed check would do harm. Treating middleware as the authorization boundary is a
 * common way to end up with an unprotected server action.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/** Paths that require a signed-in officer. Everything else is public. */
const PROTECTED = ['/admin', '/process', '/messages']

export async function proxy(request: NextRequest) {
  // --- rescue a sign-in code that arrived at the wrong path ---
  //
  // Only /auth/callback can exchange a magic-link code for a session. But the code
  // does not always arrive there: Supabase falls back to the project's Site URL
  // whenever the requested redirect is not in its allow list, and a Site URL is
  // usually a bare domain. From "/" it then follows whatever redirects the app has,
  // and lands somewhere that ignores it — for us, at the sign-in page, which is a
  // uniquely confusing place to be told to sign in.
  //
  // Rather than depend on a setting in someone else's dashboard being exactly
  // right, treat a `code` parameter as meaning what it says wherever it turns up.
  const code = request.nextUrl.searchParams.get('code')
  if (code && request.nextUrl.pathname !== '/auth/callback') {
    const callback = request.nextUrl.clone()
    callback.pathname = '/auth/callback'

    // Where they were headed: an explicit `next`, otherwise the path the code
    // landed on — unless that is the sign-in page, which would loop.
    const landed = request.nextUrl.pathname
    const next =
      request.nextUrl.searchParams.get('next') ??
      (landed === '/sign-in' || landed === '/' ? '/messages' : landed)

    callback.searchParams.set('next', next)
    return NextResponse.redirect(callback)
  }

  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  // Without Supabase configured there is no session to refresh. Public pages should
  // still render, so fail open here — the protected paths below are handled by the
  // absence of a user, not by this branch.
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
        // Write to both the request (so this pass sees them) and the response (so
        // the browser does).
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // getUser() revalidates the token with Supabase rather than trusting the cookie.
  // Do not swap this for getSession(), which reads the cookie without verifying it.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const needsAuth = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))

  if (needsAuth && !user) {
    const signIn = request.nextUrl.clone()
    signIn.pathname = '/sign-in'
    // Send them back where they were headed once they are in.
    signIn.searchParams.set('next', path)
    return NextResponse.redirect(signIn)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Public results pages do pass
     * through here — that is intentional, so a signed-in officer keeps a live
     * session while browsing them.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

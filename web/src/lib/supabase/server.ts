// Request-scoped Supabase client for the signed-in officer.
//
// This client carries the user's session (via cookies) and uses the publishable
// key, so it is subject to Row Level Security. Since our schema grants the API
// roles nothing, this client can read almost nothing directly — which is
// intentional. Its job is authentication: establishing *who* is asking.
//
// The pattern is: use this to identify and authorize the user, then use the
// admin client to do the actual data work.
import 'server-only'

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Shape @supabase/ssr hands back when it wants cookies written. */
type CookieToSet = { name: string; value: string; options?: CookieOptions }

/** Supabase client bound to the current request's cookies. */
export async function supabaseServer() {
  const cookieStore = await cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set. ' +
        'See web/.env.example.'
    )
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components cannot set cookies. That is fine here: the
          // middleware refreshes the session on every request, so a failure to
          // write from a render pass is not a problem.
        }
      },
    },
  })
}

/** The signed-in Supabase user, or null. */
export async function getUser() {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

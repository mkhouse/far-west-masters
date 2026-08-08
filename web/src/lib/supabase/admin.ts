// Service-role Supabase client.
//
// This client uses the secret service_role key, which **bypasses Row Level
// Security entirely**. It can read every member's phone number and email
// address. It is the single most sensitive thing in this codebase.
//
// The database is deliberately locked down: RLS is on for every table, no
// policies grant access, and the API roles have had their privileges revoked.
// That means normal browser access reads nothing at all, and all legitimate
// data access flows through server code holding this key.
//
// `server-only` makes that guarantee enforceable rather than aspirational: if
// any client component ever imports this file — directly or through a chain of
// imports — the build fails instead of shipping the key to browsers.
import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

/**
 * The admin client, created lazily so a missing key surfaces where it is used
 * rather than at module load (which would break unrelated pages).
 *
 * Use this for: publishing results, sending texts, importing rosters, and
 * rendering public pages at build time.
 *
 * Do NOT use it to act on behalf of a signed-in user — it has no notion of who
 * that is, so authorization has to be checked explicitly before calling it.
 */
export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Copy it from the Supabase dashboard ' +
        '(Settings -> API) into web/.env.local. It must never be committed.'
    )
  }

  cached = createClient(url, serviceRoleKey, {
    auth: {
      // This is a machine client: it has no user session to persist or refresh,
      // and should never pick one up from storage.
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return cached
}

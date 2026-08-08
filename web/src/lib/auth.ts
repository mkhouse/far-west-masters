// Authorization helpers.
//
// Authentication (who you are) comes from Supabase Auth via magic link.
// Authorization (what you may do) comes from the `app_users` table, which maps a
// Supabase user id to a role.
//
// Roles, per the project spec:
//   admin      season setup, race schedule, user management, everything below
//   processor  import and publish results, send messages
//
// The public results pages need no login at all — they are rendered server-side
// and contain no member contact information.
import 'server-only'

import { getUser } from './supabase/server'
import { supabaseAdmin } from './supabase/admin'

export type AppRole = 'admin' | 'processor'

export interface AppUser {
  userId: string
  email: string | null
  role: AppRole
  personId: string | null
}

/**
 * The signed-in officer, or null if not signed in or not authorized.
 *
 * Note the deliberate asymmetry: a valid Supabase login is not enough. Anyone
 * can request a magic link, so access requires a matching row in `app_users`,
 * which only an admin can create. Signing in is not the same as being let in.
 */
export async function getAppUser(): Promise<AppUser | null> {
  const user = await getUser()
  if (!user) return null

  // Read through the admin client: `app_users` is not readable by the API roles,
  // so the user's own client cannot look up its own role.
  const { data, error } = await supabaseAdmin()
    .from('app_users')
    .select('user_id, role, person_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return null

  return {
    userId: data.user_id as string,
    email: user.email ?? null,
    role: data.role as AppRole,
    personId: (data.person_id as string | null) ?? null,
  }
}

/**
 * Require a signed-in officer, optionally of a specific role.
 * Throws rather than returning null so a forgotten check cannot silently
 * become an authorization hole.
 *
 * @param role  Require exactly this role. Admins satisfy 'processor' too.
 */
export async function requireAppUser(role?: AppRole): Promise<AppUser> {
  const appUser = await getAppUser()
  if (!appUser) throw new Error('UNAUTHORIZED')

  // Admins can do anything a processor can.
  if (role === 'admin' && appUser.role !== 'admin') throw new Error('FORBIDDEN')

  return appUser
}

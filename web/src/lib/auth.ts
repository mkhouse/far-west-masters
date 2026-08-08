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
 *
 * The one way an `app_users` row appears without an admin running SQL is an
 * invitation that admin recorded earlier — see claimInvitation below.
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

  if (error) return null

  // No grant yet. Before refusing, see whether an admin already decided this
  // person may come in. Reached only on the unauthorized path, so an ordinary
  // request by an already-granted officer never touches the invitations table.
  if (!data) return claimInvitation(user.id, user.email ?? null)

  return {
    userId: data.user_id as string,
    email: user.email ?? null,
    role: data.role as AppRole,
    personId: (data.person_id as string | null) ?? null,
  }
}

/**
 * Turn a standing invitation into a real grant, on first sign-in.
 *
 * Access still originates with an admin — the invitation is the decision, made in
 * advance. This only converts it, so that adding an officer does not require both
 * people to be present at the same time.
 *
 * The email address is the match key, and therefore the credential: whoever can
 * read that mailbox becomes this officer. That is already true of magic-link
 * sign-in, but it is why an unclaimed invitation should be revoked (deleted) once
 * it is no longer wanted, rather than left lying around.
 *
 * @returns the newly granted user, or null if there was no invitation for them.
 */
async function claimInvitation(userId: string, email: string | null): Promise<AppUser | null> {
  if (!email) return null

  const db = supabaseAdmin()
  const lowered = email.toLowerCase()

  const { data: invite } = await db
    .from('app_user_invites')
    .select('email, role')
    .eq('email', lowered)
    .is('claimed_at', null)
    .maybeSingle()

  if (!invite) return null

  const role = invite.role as AppRole

  // Link to their member record where the emails match, so the send log shows a
  // name rather than an address. A missing link is survivable — the log falls back
  // to the email — so it must not stop the grant.
  const { data: person } = await db
    .from('people')
    .select('id')
    .ilike('email', lowered)
    .limit(1)
    .maybeSingle()

  const personId = (person?.id as string | null) ?? null

  // `ignoreDuplicates` matters: two requests can arrive together on first sign-in
  // — a page and its data fetch — and both would find the same open invitation.
  // Whichever loses the race must not error, and must not grant twice.
  const { error: insertError } = await db
    .from('app_users')
    .upsert({ user_id: userId, role, person_id: personId }, {
      onConflict: 'user_id',
      ignoreDuplicates: true,
    })

  if (insertError) return null

  // Mark the invitation used. Conditioned on it still being unclaimed so that a
  // concurrent request cannot overwrite the first claim's timestamp.
  await db
    .from('app_user_invites')
    .update({ claimed_at: new Date().toISOString(), claimed_user_id: userId })
    .eq('email', lowered)
    .is('claimed_at', null)

  return { userId, email, role, personId }
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

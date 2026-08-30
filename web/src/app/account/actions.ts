'use server'

/**
 * The signed-in officer's own settings.
 *
 * Only one thing lives here so far: the number they are willing to give to members.
 * Note what these actions deliberately cannot do — change anyone else's, or change a
 * role. An officer editing their own contact number needs no elevated permission, and
 * granting one would make this a user-management screen by accident.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { toE164 } from '@/lib/phone'

/**
 * Set or change the officer's published contact number.
 *
 * Refuses anything that will not normalise. A number that fails here would fail at
 * Twilio later, or — worse for this particular field — succeed as text and be read
 * off a phone screen by a member trying to return a call. Nine digits is a typo, not
 * a phone number, and the useful moment to say so is now.
 */
export async function setContactPhone(formData: FormData) {
  const appUser = await requireAppUser()

  const next = String(formData.get('next') ?? '') || '/account'
  const raw = String(formData.get('contact_phone') ?? '').trim()

  const fail = (msg: string) =>
    redirect(`/account?error=${encodeURIComponent(msg)}&next=${encodeURIComponent(next)}`)

  if (!raw) {
    fail('Enter a number, or use Remove to clear the one on file.')
    return
  }

  const e164 = toE164(raw)
  if (!e164) {
    fail(
      `“${raw}” is not a ten-digit US or Canadian number. ` +
        'Check for a missing or extra digit.'
    )
    return
  }

  const { error } = await supabaseAdmin()
    .from('app_users')
    .update({ contact_phone: e164 })
    .eq('user_id', appUser.userId)

  if (error) {
    fail(`Could not save that number: ${error.message}`)
    return
  }

  revalidatePath('/account')
  revalidatePath('/messages/compose')

  // Back where they came from. Someone who arrived here because a template needed a
  // number wants to be returned to the message, not left on a settings page.
  redirect(next)
}

/**
 * The same thing, called from a button rather than submitted as a form.
 *
 * This exists so an officer who picks a template needing {officer phone} can set it
 * without leaving the message they are part-way through writing. Sending them to
 * /account and back would mean losing the audience, the category and anything already
 * typed — a settings detour in the middle of a task, to fix something they only
 * learned about because the task stopped.
 *
 * Returns a result instead of redirecting, because the caller is a component that
 * wants to fill the placeholder in place and carry on. Nested <form> elements are
 * invalid HTML, so this cannot be a form action inside the composer anyway.
 */
export async function saveContactPhone(
  raw: string
): Promise<{ ok: true; phone: string } | { ok: false; error: string }> {
  const appUser = await requireAppUser()

  const e164 = toE164(raw)
  if (!e164) {
    return {
      ok: false,
      error: `“${raw.trim()}” is not a ten-digit US or Canadian number.`,
    }
  }

  const { error } = await supabaseAdmin()
    .from('app_users')
    .update({ contact_phone: e164 })
    .eq('user_id', appUser.userId)

  if (error) return { ok: false, error: `Could not save that number: ${error.message}` }

  revalidatePath('/account')
  return { ok: true, phone: e164 }
}

/**
 * Clear it.
 *
 * Not a deletion of anything historical: messages already sent stored the number in
 * their body at send time, so removing it here changes nothing that has gone out. It
 * only stops future templates filling it — which is what an officer standing down
 * from the role wants.
 */
export async function clearContactPhone() {
  const appUser = await requireAppUser()

  await supabaseAdmin()
    .from('app_users')
    .update({ contact_phone: null })
    .eq('user_id', appUser.userId)

  revalidatePath('/account')
  revalidatePath('/messages/compose')
  redirect('/account?cleared=1')
}

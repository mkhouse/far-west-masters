'use server'

/**
 * Recipient group management.
 *
 * Every action re-checks that the caller is an admin. Middleware only establishes
 * that someone is signed in — authorisation belongs next to the data, because a
 * server action is reachable directly and a missed check here would let any
 * signed-in user change who receives messages.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function createGroup(formData: FormData) {
  const appUser = await requireAppUser('admin')

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return

  const isTest = formData.get('is_test_group') === 'on'

  // No consent-gate exemption. Every group applies the gate — see migration 0020 —
  // so a group decides who is asked, never whether consent applies.
  await supabaseAdmin()
    .from('recipient_groups')
    .insert({
      name,
      description: String(formData.get('description') ?? '').trim() || null,
      is_test_group: isTest,
      created_by: appUser.userId,
    })

  revalidatePath('/admin/groups')
}

export async function deleteGroup(formData: FormData) {
  await requireAppUser('admin')
  const id = String(formData.get('group_id') ?? '')
  if (!id) return

  await supabaseAdmin().from('recipient_groups').delete().eq('id', id)
  revalidatePath('/admin/groups')
}

/**
 * Add one or more people to a group.
 *
 * Takes every `person_id` in the form, so the picker can submit a whole selection
 * at once rather than one page load per person.
 */
export async function addMembers(formData: FormData) {
  await requireAppUser('admin')
  const groupId = String(formData.get('group_id') ?? '')
  const personIds = formData.getAll('person_id').map(String).filter(Boolean)
  if (!groupId || personIds.length === 0) return

  await supabaseAdmin()
    .from('recipient_group_members')
    // `ignoreDuplicates` because two officers adding the same person at once, or a
    // resubmitted form, should be a no-op rather than an error.
    .upsert(
      personIds.map((person_id) => ({ group_id: groupId, person_id })),
      { onConflict: 'group_id,person_id', ignoreDuplicates: true }
    )

  revalidatePath('/admin/groups')
}

/**
 * Rename a group, or change its description.
 *
 * Note what this does NOT change: `messages.audience_label` on messages already
 * sent. That is a snapshot of what was chosen at the time, and renaming a group
 * afterwards must not rewrite what the send log says went where.
 */
export async function updateGroup(formData: FormData) {
  await requireAppUser('admin')
  const id = String(formData.get('group_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!id || !name) return

  const { error } = await supabaseAdmin()
    .from('recipient_groups')
    .update({
      name,
      description: String(formData.get('description') ?? '').trim() || null,
    })
    .eq('id', id)

  // Group names are unique. Surface the collision in words rather than as a raw
  // constraint violation, which reads as the system being broken.
  if (error) {
    redirect(
      `/admin/groups?error=${encodeURIComponent(
        error.code === '23505'
          ? `There is already a group called “${name}”.`
          : `Could not rename the group: ${error.message}`
      )}`
    )
  }

  revalidatePath('/admin/groups')
}

export async function removeMember(formData: FormData) {
  await requireAppUser('admin')
  const groupId = String(formData.get('group_id') ?? '')
  const personId = String(formData.get('person_id') ?? '')
  if (!groupId || !personId) return

  await supabaseAdmin()
    .from('recipient_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('person_id', personId)

  revalidatePath('/admin/groups')
}

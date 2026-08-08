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
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function createGroup(formData: FormData) {
  const appUser = await requireAppUser('admin')

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return

  // Bypassing the consent gate is deliberately opt-in and defaults off. Most groups
  // — officials, board members — are still people who must have agreed to receive
  // texts. Only test groups have a good reason to skip it.
  const bypasses = formData.get('bypasses_consent_gate') === 'on'
  const isTest = formData.get('is_test_group') === 'on'

  await supabaseAdmin()
    .from('recipient_groups')
    .insert({
      name,
      description: String(formData.get('description') ?? '').trim() || null,
      bypasses_consent_gate: bypasses,
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

export async function addMember(formData: FormData) {
  await requireAppUser('admin')
  const groupId = String(formData.get('group_id') ?? '')
  const personId = String(formData.get('person_id') ?? '')
  if (!groupId || !personId) return

  await supabaseAdmin()
    .from('recipient_group_members')
    .insert({ group_id: groupId, person_id: personId })

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

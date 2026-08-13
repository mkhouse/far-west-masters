'use server'

/**
 * Member edits.
 *
 * Deliberately narrow. The only field editable here is the USSA number, because it
 * is the one gap that stops somebody racing and it decides nothing about messaging.
 *
 * The four fields that DO decide whether a person receives a text — opt_in_at,
 * intro_sent_at, opted_out_at, sms_never — stay read-only until they can be edited
 * with an audit trail recording who changed what, when, and from what. "Why is this
 * person suddenly eligible" is a question that must have an answer.
 */

import { revalidatePath } from 'next/cache'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * Set or clear a member's USSA number.
 *
 * An empty value clears it, which is the honest way to undo a mistyped entry —
 * better than leaving a wrong number that looks like a real one.
 */
export async function setUsssa(
  personId: string,
  raw: string
): Promise<ActionResult> {
  await requireAppUser()

  const trimmed = raw.trim()

  // Digits only. USSA numbers are printed on cards with spaces and sometimes a
  // stray dash, so those are stripped rather than rejected — retyping a number
  // because of a space is exactly the friction that stops the gap being filled.
  const digits = trimmed.replace(/[\s-]/g, '')

  if (digits && !/^\d+$/.test(digits)) {
    return { ok: false, error: 'A USSA number is digits only.' }
  }

  const db = supabaseAdmin()

  // Check for a clash first, so the message can name the person. The unique
  // constraint would catch it anyway, but "23505" tells nobody anything, and the
  // usual cause is either a typo or two records for the same human.
  if (digits) {
    const { data: clash } = await db
      .from('people')
      .select('id, first_name, last_name')
      .eq('usssa', Number(digits))
      .neq('id', personId)
      .maybeSingle()

    if (clash) {
      return {
        ok: false,
        error: `${clash.first_name} ${clash.last_name} already has that number — check for a typo, or whether these are the same person.`,
      }
    }
  }

  const { error } = await db
    .from('people')
    .update({
      usssa: digits ? Number(digits) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', personId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/members')
  revalidatePath(`/members/${personId}`)
  return { ok: true }
}

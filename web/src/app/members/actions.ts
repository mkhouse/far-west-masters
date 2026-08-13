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
 * Fill in a MISSING USSA number.
 *
 * Adding one where there is none is gap-filling: eighteen members cannot race
 * without it, and the fix should be possible wherever the gap is noticed.
 *
 * Changing an existing one is a different act. That number is how a person is
 * identified in race results, so altering it can silently detach someone from
 * their own history — and unlike a blank, a wrong number looks correct. It belongs
 * in the member admin screen alongside the other consequential edits, where it can
 * be recorded rather than done in passing.
 *
 * Refused here as well as hidden in the UI. A rule that only the interface
 * enforces is not a rule.
 */
export async function setUsssa(
  personId: string,
  raw: string
): Promise<ActionResult> {
  await requireAppUser()

  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: 'Enter a USSA number.' }

  // Digits only. USSA numbers are printed on cards with spaces and sometimes a
  // stray dash, so those are stripped rather than rejected — retyping a number
  // because of a space is exactly the friction that stops the gap being filled.
  const digits = trimmed.replace(/[\s-]/g, '')

  if (digits && !/^\d+$/.test(digits)) {
    return { ok: false, error: 'A USSA number is digits only.' }
  }

  const db = supabaseAdmin()

  // Only fill a blank. Read the current value rather than trusting the page that
  // called this — a stale tab could otherwise overwrite a number added since.
  const { data: current } = await db
    .from('people')
    .select('usssa')
    .eq('id', personId)
    .maybeSingle()

  if (current?.usssa) {
    return {
      ok: false,
      error:
        'This member already has a USSA number. Changing an existing number will be possible from member admin.',
    }
  }

  // Check for a clash, so the message can name the person. The unique constraint
  // would catch it anyway, but "23505" tells nobody anything, and the usual cause
  // is either a typo or two records for the same human.
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

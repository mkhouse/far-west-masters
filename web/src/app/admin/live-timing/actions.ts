'use server'

/**
 * Saving a race's live-timing id.
 *
 * The id is how results are fetched after the race, so a wrong one imports
 * somebody else's results under this race's name. It is therefore confirmed by
 * a person every time, even when the lookup is certain — see
 * lib/live-timing.ts, which refuses to guess rather than offering a plausible
 * id it cannot justify.
 */

import { revalidatePath } from 'next/cache'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface SaveIdResult {
  ok: boolean
  error?: string
  message?: string
}

export async function saveLiveTimingId(
  _prev: SaveIdResult | null,
  formData: FormData
): Promise<SaveIdResult> {
  await requireAppUser()

  const raceId = String(formData.get('race_id') ?? '')
  const raw = String(formData.get('live_timing_id') ?? '').trim()
  if (!raceId) return { ok: false, error: 'No race.' }

  // Empty clears it, which is how a wrong id gets taken back out.
  if (raw === '') {
    const { error } = await supabaseAdmin()
      .from('races')
      .update({ live_timing_id: null })
      .eq('id', raceId)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/admin/live-timing')
    return { ok: true, message: 'Cleared.' }
  }

  // Live-timing ids are plain integers. Anything else is a pasted URL or a
  // typo, and both are worth refusing rather than storing.
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      error: 'A live-timing id is just digits — paste the number, not the whole link.',
    }
  }

  const { error } = await supabaseAdmin()
    .from('races')
    .update({ live_timing_id: Number(raw) })
    .eq('id', raceId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/admin/live-timing')
  return { ok: true, message: `Saved ${raw}.` }
}

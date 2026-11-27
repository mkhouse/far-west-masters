'use server'

/**
 * Setting a season's scoring rules.
 *
 * The rules decide every standing, and until they are set nothing scores — the
 * schedule screen says so while `best_n` is 0. Previously this was a migration
 * written by hand each year; the two figures that actually change between
 * seasons are the race count and the best-N derived from it, so the screen
 * computes both and asks for a confirmation rather than a transcription.
 */

import { revalidatePath } from 'next/cache'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface SaveResult {
  ok: boolean
  error?: string
  message?: string
}

export async function saveSeasonRules(
  _prev: SaveResult | null,
  formData: FormData
): Promise<SaveResult> {
  // Admins only. Everything else on this screen is a lookup; this one rewrites
  // how an entire season is scored.
  await requireAppUser('admin')

  const seasonId = String(formData.get('season_id') ?? '')
  if (!seasonId) return { ok: false, error: 'No season.' }

  const bestN = Number(formData.get('best_n'))
  const minStarts = Number(formData.get('min_starts'))

  if (!Number.isInteger(bestN) || bestN < 1) {
    return { ok: false, error: 'Best-N must be a whole number of at least 1.' }
  }
  if (!Number.isInteger(minStarts) || minStarts < 0) {
    return { ok: false, error: 'Minimum starts must be a whole number.' }
  }

  const db = supabaseAdmin()

  // Recounted here rather than taken from the form. The page that rendered the
  // form could be minutes old, and a schedule import in between would make the
  // stored total disagree with the races it is supposed to describe.
  const { data: raceRows } = await db
    .from('races')
    .select('id')
    .eq('season_id', seasonId)
    .eq('counts_toward_standings', true)

  const counting = raceRows?.length ?? 0
  if (counting === 0) {
    return {
      ok: false,
      error:
        'No races count toward standings for this season yet. Import the schedule first.',
    }
  }

  if (bestN > counting) {
    return {
      ok: false,
      error: `Best-${bestN} is more than the ${counting} races that count. Nobody could ever qualify.`,
    }
  }

  /**
   * The points scale and age groups are carried forward, never typed.
   *
   * The scale was measured from FWM's own published standings — see
   * WC_POINTS_SCALE in results-engine/src/types.ts — and retyping thirty
   * numbers once a year is a way to get one of them wrong. If the club ever
   * changes it, that is rare enough to be a migration.
   */
  const { data: season } = await db
    .from('seasons')
    .select('points_scale, age_groups')
    .eq('id', seasonId)
    .maybeSingle()

  const patch: Record<string, unknown> = {
    best_n: bestN,
    total_races: counting,
    min_starts_for_award: minStarts,
    rules_verified: true,
  }

  if (!season?.points_scale) {
    const { data: previous } = await db
      .from('seasons')
      .select('points_scale')
      .not('points_scale', 'is', null)
      .neq('id', seasonId)
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!previous?.points_scale) {
      return {
        ok: false,
        error:
          'No earlier season has a points scale to carry forward. This one needs setting in a migration.',
      }
    }
    patch.points_scale = previous.points_scale
  }

  const { error } = await db.from('seasons').update(patch).eq('id', seasonId)
  if (error) return { ok: false, error: `Could not save: ${error.message}` }

  revalidatePath('/admin/season')
  revalidatePath('/admin/schedule')

  return {
    ok: true,
    message: `Best ${bestN} of ${counting} races, minimum ${minStarts} starts.`,
  }
}

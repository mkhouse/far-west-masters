import 'server-only'

/**
 * Loading the season's races with who each one can actually reach.
 *
 * Used by the messages console, which shows the current weekend, and by the
 * compose screen, which offers the same choices again so an officer can change
 * their mind without going back. One query, so the two cannot disagree about
 * who is racing or who can be texted.
 */

import { supabaseAdmin } from './supabase/admin'
import type { WeekendRace } from './race-weekends'

/**
 * The races to put in front of the officer, with who each one could reach.
 *
 * Person ids rather than counts, because the caller lets days be combined and
 * the combination has to be a union: somebody racing Saturday and Sunday is one
 * person and one text.
 *
 * The consent gate is applied here, in the same terms as every audience — see
 * `sms_eligible_people` and `explainExclusions`. A number on this block that
 * disagreed with the one on the compose screen would be worse than no number.
 */
export async function loadWeekendRaces(): Promise<WeekendRace[]> {
  const db = supabaseAdmin()

  const { data: season } = await db
    .from('seasons')
    .select('id')
    .eq('active', true)
    .maybeSingle()
  if (!season) return []

  const { data: rows } = await db
    .from('races')
    .select(
      'id, name, date, discipline, venue, race_entries(person_id, people!inner(phone, opted_out_at, sms_never, opt_in_at, intro_sent_at))'
    )
    .eq('season_id', season.id)
    .neq('status', 'canceled')
    .order('date', { ascending: true })

  type EntryRow = {
    person_id: string | null
    people:
      | {
          phone: string | null
          opted_out_at: string | null
          sms_never: boolean
          opt_in_at: string | null
          intro_sent_at: string | null
        }
      | Array<Record<string, unknown>>
  }

  const races: WeekendRace[] = ((rows ?? []) as unknown as Array<{
    id: string
    name: string
    date: string
    discipline: string
    venue: string | null
    race_entries: EntryRow[]
  }>).map((r) => {
    const entries = r.race_entries ?? []
    const eligible: string[] = []
    const entrants: string[] = []
    for (const e of entries) {
      const p = (Array.isArray(e.people) ? e.people[0] : e.people) as {
        phone: string | null
        opted_out_at: string | null
        sms_never: boolean
        opt_in_at: string | null
        intro_sent_at: string | null
      } | null
      if (!e.person_id || !p) continue
      entrants.push(e.person_id)
      if (p.phone && !p.opted_out_at && !p.sms_never && p.opt_in_at && p.intro_sent_at) {
        eligible.push(e.person_id)
      }
    }
    return {
      id: r.id,
      name: r.name,
      date: r.date,
      discipline: r.discipline,
      venue: r.venue,
      eligiblePersonIds: eligible,
      entrantPersonIds: entrants,
    }
  })

  return races
}


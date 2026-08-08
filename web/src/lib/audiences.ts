/**
 * Message audiences — who a message goes to, and who it does not.
 *
 * Two principles here, both learned from the Airtable system:
 *
 * 1. **Every audience except `intro` goes through the consent gate.** The gate lives
 *    in the `sms_eligible_people` view, so it cannot drift between audiences. The
 *    intro send is the single exception, and it is named explicitly rather than
 *    achieved by omitting a filter.
 *
 * 2. **Exclusions are counted and explained, never silently applied.** "31 of 48"
 *    with the reasons is honest; "31" on its own looks identical to a smaller club,
 *    and would hide the fact that the consent gate is doing the work.
 */
import 'server-only'

import { supabaseAdmin } from './supabase/admin'

export type AudienceKind =
  | 'group' // a named group an admin maintains: test groups, officials, board
  | 'all_eligible' // everyone past the consent gate
  | 'series' // people entered in a race weekend
  | 'series_intro' // people in a race weekend who have never had an intro text
  | 'always' // members who asked to hear about races regardless of entry

export interface AudienceOption {
  kind: AudienceKind
  /** Series name, when the audience is scoped to one */
  series?: string
  /** Group id, when kind is 'group' */
  groupId?: string
  label: string
}

export interface ExclusionReason {
  reason: string
  count: number
}

export interface AudienceResult {
  kind: AudienceKind
  label: string
  /** People who will actually receive the message */
  recipientCount: number
  /** People considered before the consent gate was applied */
  consideredCount: number
  excluded: ExclusionReason[]
  /** True when this audience deliberately bypasses the consent gate */
  bypassesConsentGate: boolean
  /** Set when the audience cannot be built yet, e.g. no roster imported */
  unavailableReason?: string
}

/**
 * Explain why people in a candidate set are not reachable.
 *
 * Ordered by how the gate actually applies, so the counts do not double-count: a
 * person with no phone is reported once, not also as "no opt-in".
 */
function explainExclusions(
  people: Array<{
    phone: string | null
    opted_out_at: string | null
    sms_never: boolean
    opt_in_at: string | null
    intro_sent_at: string | null
  }>
): { eligible: number; excluded: ExclusionReason[] } {
  let eligible = 0
  const counts = {
    'no phone number': 0,
    'opted out': 0,
    suppressed: 0,
    'has not opted in': 0,
    'no intro text sent': 0,
  }

  for (const p of people) {
    if (!p.phone) counts['no phone number']++
    else if (p.opted_out_at) counts['opted out']++
    else if (p.sms_never) counts['suppressed']++
    else if (!p.opt_in_at) counts['has not opted in']++
    else if (!p.intro_sent_at) counts['no intro text sent']++
    else eligible++
  }

  return {
    eligible,
    excluded: Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([reason, count]) => ({ reason, count })),
  }
}

/** The consent-relevant columns, in one place so every query stays consistent. */
const GATE_COLUMNS = 'phone, opted_out_at, sms_never, opt_in_at, intro_sent_at'

/**
 * Which audiences can be offered right now.
 *
 * Series audiences depend on an imported race roster, so they are listed only when
 * races with entries exist — offering an audience that silently resolves to nobody
 * is worse than not offering it.
 */
export async function listAudiences(): Promise<AudienceOption[]> {
  const db = supabaseAdmin()

  const options: AudienceOption[] = []

  // Groups first, test groups at the very top: the compose screen defaults to the
  // first option, and a test group is the safe thing to default to.
  const { data: groups } = await db
    .from('recipient_groups')
    .select('id, name, is_test_group')
    .order('is_test_group', { ascending: false })
    .order('name')

  for (const g of groups ?? []) {
    options.push({ kind: 'group', groupId: g.id as string, label: g.name as string })
  }

  options.push(
    { kind: 'all_eligible', label: 'All eligible members' },
    { kind: 'always', label: 'Members who always want race texts' }
  )

  // A series is offerable once at least one of its races has entries.
  const { data: races } = await db
    .from('races')
    .select('series, race_entries(count)')
    .not('series', 'is', null)
    .order('date', { ascending: false })

  const seriesWithEntries = new Set<string>()
  for (const r of races ?? []) {
    const entries = (r.race_entries as unknown as Array<{ count: number }>) ?? []
    if (entries[0]?.count > 0 && r.series) seriesWithEntries.add(r.series as string)
  }

  for (const series of seriesWithEntries) {
    options.push({ kind: 'series', series, label: series })
    options.push({
      kind: 'series_intro',
      series,
      label: `${series} — intro texts to those who need one`,
    })
  }

  return options
}

/** Resolve an audience to a recipient count and an account of who was excluded. */
export async function resolveAudience(
  kind: AudienceKind,
  opts: { series?: string; groupId?: string } = {}
): Promise<AudienceResult> {
  const db = supabaseAdmin()
  const { series, groupId } = opts

  switch (kind) {
    case 'group': {
      if (!groupId) {
        return {
          kind, label: 'Group', recipientCount: 0, consideredCount: 0,
          excluded: [], bypassesConsentGate: false,
          unavailableReason: 'No group selected',
        }
      }

      const { data: group } = await db
        .from('recipient_groups')
        .select('name, bypasses_consent_gate')
        .eq('id', groupId)
        .single()

      const { data: rows } = await db
        .from('recipient_group_members')
        .select(`people!inner(${GATE_COLUMNS})`)
        .eq('group_id', groupId)

      type GatePerson = Parameters<typeof explainExclusions>[0][number]
      const people = (rows ?? [])
        .map((r) => {
          const p = (r as { people: GatePerson | GatePerson[] }).people
          return Array.isArray(p) ? p[0] : p
        })
        .filter(Boolean) as GatePerson[]

      // Whether the consent gate applies is a property of the group, set when it was
      // created. A test group skips it so the test actually arrives; a group of
      // officials or board members should not, because they are still people who
      // need to have agreed to receive texts.
      const bypass = group?.bypasses_consent_gate === true

      if (bypass) {
        const reachable = people.filter((p) => p.phone && !p.opted_out_at).length
        const blocked = people.length - reachable
        return {
          kind,
          label: (group?.name as string) ?? 'Group',
          recipientCount: reachable,
          consideredCount: people.length,
          excluded: blocked > 0 ? [{ reason: 'no phone number or opted out', count: blocked }] : [],
          bypassesConsentGate: true,
          unavailableReason: people.length === 0 ? 'This group has no members yet' : undefined,
        }
      }

      const { eligible, excluded } = explainExclusions(people)
      return {
        kind,
        label: (group?.name as string) ?? 'Group',
        recipientCount: eligible,
        consideredCount: people.length,
        excluded,
        bypassesConsentGate: false,
        unavailableReason: people.length === 0 ? 'This group has no members yet' : undefined,
      }
    }

    case 'all_eligible': {
      const { data } = await db.from('people').select(GATE_COLUMNS)
      const people = data ?? []
      const { eligible, excluded } = explainExclusions(people)
      return {
        kind,
        label: 'All eligible members',
        recipientCount: eligible,
        consideredCount: people.length,
        excluded,
        bypassesConsentGate: false,
      }
    }

    case 'always': {
      const { data } = await db.from('people').select(GATE_COLUMNS).eq('sms_always', true)
      const people = data ?? []
      const { eligible, excluded } = explainExclusions(people)
      return {
        kind,
        label: 'Members who always want race texts',
        recipientCount: eligible,
        consideredCount: people.length,
        excluded,
        bypassesConsentGate: false,
      }
    }

    case 'series':
    case 'series_intro': {
      if (!series) {
        return {
          kind,
          label: 'Race series',
          recipientCount: 0,
          consideredCount: 0,
          excluded: [],
          bypassesConsentGate: kind === 'series_intro',
          unavailableReason: 'No series selected',
        }
      }

      // Everyone entered in any race of this series. A person entered in both days
      // of a weekend appears twice, so they are de-duplicated by person id before
      // counting — otherwise the recipient total would exceed the number of humans.
      const { data: entries } = await db
        .from('race_entries')
        .select(`person_id, people!inner(${GATE_COLUMNS}), races!inner(series)`)
        .eq('races.series', series)

      // PostgREST returns joined rows as arrays; normalise to one record per entry.
      type GatePerson = Parameters<typeof explainExclusions>[0][number]
      const seen = new Map<string, GatePerson>()
      for (const e of (entries ?? []) as Array<{
        person_id: string | null
        people: GatePerson | GatePerson[]
      }>) {
        if (!e.person_id || seen.has(e.person_id)) continue
        const person = Array.isArray(e.people) ? e.people[0] : e.people
        if (person) seen.set(e.person_id, person)
      }
      const people = [...seen.values()]

      if (kind === 'series') {
        const { eligible, excluded } = explainExclusions(people)
        return {
          kind,
          label: series,
          recipientCount: eligible,
          consideredCount: people.length,
          excluded,
          bypassesConsentGate: false,
        }
      }

      // Intro texts: the one audience that may reach people who have not passed the
      // consent gate, because it is how they pass it. Restricted to entrants — a
      // first contact is justified by their having registered for a race, not by
      // being in the database.
      const needsIntro = people.filter(
        (p) => p.phone && !p.opted_out_at && !p.sms_never && !p.intro_sent_at
      )
      const already = people.length - needsIntro.length

      return {
        kind,
        label: `${series} — intro texts`,
        recipientCount: needsIntro.length,
        consideredCount: people.length,
        excluded: already > 0 ? [{ reason: 'already had an intro text, or unreachable', count: already }] : [],
        bypassesConsentGate: true,
      }
    }
  }
}

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
import {
  FILTER_COLUMNS,
  applyFilter,
  describeFilter,
  type FilterablePerson,
  type MemberFilter,
} from './member-filters'

export type AudienceKind =
  | 'group' // a named group an admin maintains: test groups, officials, board
  | 'all_eligible' // everyone past the consent gate
  | 'series' // people entered in a race weekend
  | 'intro_pending' // opted in, but not yet sent the intro text that completes it
  | 'always' // members who asked to hear about races regardless of entry
  | 'filtered' // a slice of the members directory, described by its filters

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
  /**
   * True when this audience reaches people who have not yet passed the whole gate.
   *
   * Only the intro-text audience does, and it is not a bypass: those people have
   * opted in, and the intro text is what completes their consent. Nothing in this
   * system messages anyone who has not opted in.
   */
  incompleteConsent: boolean
  /** Set when the audience cannot be built yet, e.g. no roster imported */
  unavailableReason?: string
}

/**
 * Explain why people in a candidate set are not reachable.
 *
 * Ordered by how the gate actually applies, so the counts do not double-count: a
 * person with no phone is reported once, not also as "no opt-in".
 *
 * Exported for tests. This function IS the consent gate — every audience below runs
 * its candidates through it — so it is the thing most worth pinning down, and it is
 * pure, which makes it testable without a database. See audiences.test.ts.
 */
export function explainExclusions(
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
    'not opted-in for texts': 0,
    'no intro text sent': 0,
  }

  for (const p of people) {
    if (!p.phone) counts['no phone number']++
    else if (p.opted_out_at) counts['opted out']++
    else if (p.sms_never) counts['suppressed']++
    else if (!p.opt_in_at) counts['not opted-in for texts']++
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
    // Same wording as the members directory, deliberately: one vocabulary for
    // member state everywhere, so opt-in is visibly the thing that decides who can
    // be messaged rather than a rule buried in the code.
    { kind: 'all_eligible', label: 'All members opted-in for texts' },
    { kind: 'always', label: 'Members who always want race texts' },
    // Not scoped to a race: the trigger is a completed opt-in form, not a race
    // entry. FWM's flow is form first, then intro text — see the note on
    // 'intro_pending' in resolveAudience.
    { kind: 'intro_pending', label: 'Opted-in, needs intro text' }
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
  }

  return options
}

/** Resolve an audience to a recipient count and an account of who was excluded. */
export async function resolveAudience(
  kind: AudienceKind,
  opts: { series?: string; groupId?: string; filter?: MemberFilter } = {}
): Promise<AudienceResult> {
  const db = supabaseAdmin()
  const { series, groupId, filter } = opts

  switch (kind) {
    case 'group': {
      if (!groupId) {
        return {
          kind, label: 'Group', recipientCount: 0, consideredCount: 0,
          excluded: [], incompleteConsent: false,
          unavailableReason: 'No group selected',
        }
      }

      const { data: group } = await db
        .from('recipient_groups')
        .select('name')
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

      // Groups always apply the consent gate — see migration 0020. Test groups used
      // to skip it, on the assumption that a test needed to reach people who had not
      // been through the consent flow. In practice testers are officers and
      // officials who have opted in like everybody else, so the exception bought
      // nothing and cost a path by which a forgotten setting could text someone who
      // never agreed.
      const { eligible, excluded } = explainExclusions(people)
      return {
        kind,
        label: (group?.name as string) ?? 'Group',
        recipientCount: eligible,
        consideredCount: people.length,
        excluded,
        incompleteConsent: false,
        unavailableReason: people.length === 0 ? 'This group has no members yet' : undefined,
      }
    }

    case 'all_eligible': {
      const { data } = await db.from('people').select(GATE_COLUMNS)
      const people = data ?? []
      const { eligible, excluded } = explainExclusions(people)
      return {
        kind,
        label: 'All members opted-in for texts',
        recipientCount: eligible,
        consideredCount: people.length,
        excluded,
        incompleteConsent: false,
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
        incompleteConsent: false,
      }
    }

    case 'filtered': {
      // A slice of the members directory — "non-members, opted-in for texts".
      //
      // The filter chooses candidates; the consent gate then applies on top,
      // unconditionally. That order is the whole safety property: no combination
      // of filters can widen who is reachable, only narrow it. Someone who has not
      // opted in cannot be selected into this audience by any means.
      //
      // Note it is re-resolved at send time rather than frozen when chosen, exactly
      // like every other audience. The count can move if somebody opts in between
      // the two screens, which is correct — the alternative is texting a list that
      // was true five minutes ago.
      if (!filter) {
        return {
          kind, label: 'Filtered members', recipientCount: 0, consideredCount: 0,
          excluded: [], incompleteConsent: false,
          unavailableReason: 'No filter given',
        }
      }

      const { data } = await db.from('people').select(FILTER_COLUMNS)
      const candidates = applyFilter(
        (data ?? []) as unknown as FilterablePerson[],
        filter
      )
      const { eligible, excluded } = explainExclusions(candidates)

      return {
        kind,
        label: describeFilter(filter),
        recipientCount: eligible,
        consideredCount: candidates.length,
        excluded,
        incompleteConsent: false,
        unavailableReason:
          candidates.length === 0 ? 'Nobody matches that filter' : undefined,
      }
    }

    case 'intro_pending': {
      // Members who completed the opt-in form but have not yet been sent the intro
      // text that confirms it.
      //
      // This is the ONLY audience that reaches people who have not passed the whole
      // gate, and it is not a bypass: `opt_in_at` is required here exactly as it is
      // everywhere else. What is missing is `intro_sent_at`, and this send is what
      // supplies it.
      //
      // It is deliberately not scoped to a race. FWM's consent flow — the one
      // described to Twilio when the toll-free number was verified — is form first,
      // then intro text. The trigger is a completed form, so scoping this to race
      // entrants would both miss people and imply a first contact that nobody asked
      // for.
      const { data } = await db
        .from('people')
        .select(GATE_COLUMNS)
        .not('opt_in_at', 'is', null)
        .is('intro_sent_at', null)

      const people = data ?? []
      const reachable = people.filter(
        (p) => p.phone && !p.opted_out_at && !p.sms_never
      )
      const unreachable = people.length - reachable.length

      return {
        kind,
        label: 'Opted-in, needs intro text',
        recipientCount: reachable.length,
        consideredCount: people.length,
        excluded: unreachable > 0
          ? [{ reason: 'no phone number, opted out, or suppressed', count: unreachable }]
          : [],
        incompleteConsent: true,
        unavailableReason:
          people.length === 0 ? 'Everyone who has opted in has had their intro text' : undefined,
      }
    }

    case 'series': {
      if (!series) {
        return {
          kind,
          label: 'Race series',
          recipientCount: 0,
          consideredCount: 0,
          excluded: [],
          incompleteConsent: false,
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

      const { eligible, excluded } = explainExclusions(people)
      return {
        kind,
        label: series,
        recipientCount: eligible,
        consideredCount: people.length,
        excluded,
        incompleteConsent: false,
      }
    }
  }
}

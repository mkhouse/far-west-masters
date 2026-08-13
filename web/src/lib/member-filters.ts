import 'server-only'

/**
 * The members directory's filters, in one place.
 *
 * They are defined here rather than on the page because they now decide two
 * different things: which rows a screen shows, and who a message reaches. Those
 * must be the same rule. A filter that means one thing in the directory and
 * another at send time would produce a message that goes somewhere other than the
 * list it was chosen from — which is the specific bug this file exists to prevent.
 */

import { consentState, type ConsentState } from './members'

/** Membership groupings, matching the chips on the directory. */
export const MEMBERSHIP: Record<string, { label: string; statuses: string[] }> = {
  active: { label: 'Active', statuses: ['active_member', 'officer'] },
  inactive: { label: 'Inactive', statuses: ['inactive'] },
  non_members: {
    label: 'Non-members',
    statuses: ['asr_import', 'sms_opt_in', 'out_of_region', 'temp_racer', 'non_member'],
  },
}

/** What the directory shows before anyone touches a filter. */
export const DEFAULT_MEMBERSHIP = 'active'

export interface MemberFilter {
  /** A membership key, or 'all'. */
  membership: string
  /** A consent state, or null for any. */
  texting: ConsentState | null
  /** Restrict to people with no USSA number. */
  missingUsssa: boolean
  /** Free-text search over name, phone and email. */
  query: string
}

/** Everything the filters read. Kept in one string so queries cannot drift. */
export const FILTER_COLUMNS =
  'id, first_name, last_name, status, usssa, phone, email, opt_in_at, intro_sent_at, opted_out_at, sms_never'

export interface FilterablePerson {
  id: string
  first_name: string
  last_name: string
  status: string
  usssa: number | null
  phone: string | null
  email: string | null
  opt_in_at: string | null
  intro_sent_at: string | null
  opted_out_at: string | null
  sms_never: boolean
}

/** Read a filter out of URL parameters, applying the defaults. */
export function filterFromParams(params: {
  membership?: string
  filter?: string
  missing?: string
  q?: string
}): MemberFilter {
  const membership =
    params.membership &&
    (params.membership === 'all' || MEMBERSHIP[params.membership])
      ? params.membership
      : DEFAULT_MEMBERSHIP

  return {
    membership,
    texting: (params.filter as ConsentState) || null,
    missingUsssa: params.missing === 'usssa',
    query: (params.q ?? '').trim(),
  }
}

/** Turn a filter back into URL parameters, dropping anything at its default. */
export function filterToParams(f: MemberFilter): Record<string, string> {
  return {
    membership: f.membership,
    filter: f.texting ?? '',
    missing: f.missingUsssa ? 'usssa' : '',
    q: f.query,
  }
}

/**
 * Apply a filter to a list of people.
 *
 * Search matches name, phone and email. Phone matching strips punctuation from
 * both sides, so "(530) 555-1234", "5305551234" and "+15305551234" all find the
 * same person — that is how numbers actually get typed.
 */
export function applyFilter(
  people: FilterablePerson[],
  f: MemberFilter
): FilterablePerson[] {
  const digits = f.query.replace(/\D/g, '')
  const needle = f.query.toLowerCase()

  return people.filter((p) => {
    if (f.query) {
      const name = `${p.first_name} ${p.last_name}`.toLowerCase()
      const hitPhone =
        digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits)
      if (
        !name.includes(needle) &&
        !(p.email ?? '').toLowerCase().includes(needle) &&
        !hitPhone
      ) {
        return false
      }
    }
    if (f.texting && consentState(p) !== f.texting) return false
    if (f.missingUsssa && p.usssa) return false
    if (
      f.membership !== 'all' &&
      !MEMBERSHIP[f.membership].statuses.includes(p.status)
    ) {
      return false
    }
    return true
  })
}

/**
 * Describe a filter in words, for the compose screen and the send log.
 *
 * Months later, "Non-members · opted-in for texts" answers who a message went to.
 * "filtered" does not.
 */
export function describeFilter(f: MemberFilter): string {
  const parts: string[] = []

  if (f.membership !== 'all') parts.push(MEMBERSHIP[f.membership]?.label ?? f.membership)
  if (f.texting) {
    // Imported lazily to avoid a cycle: members.ts does not know about filters.
    parts.push(TEXTING_LABEL[f.texting] ?? f.texting)
  }
  if (f.missingUsssa) parts.push('missing USSA number')
  if (f.query) parts.push(`matching “${f.query}”`)

  return parts.length ? parts.join(' · ') : 'Everyone'
}

/** Lower-case forms of the consent labels, for use inside a sentence. */
const TEXTING_LABEL: Record<string, string> = {
  eligible: 'opted-in for texts',
  awaiting_intro: 'opted-in, needs intro text',
  not_opted_in: 'not opted-in for texts',
  opted_out: 'opted out',
  suppressed: 'suppressed',
  no_phone: 'no phone number',
}

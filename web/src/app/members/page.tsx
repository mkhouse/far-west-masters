/**
 * Members directory.
 *
 * The gap this fills: until now there was no way to look a member up at all. "Is
 * Jane in the system, and why isn't she getting texts?" needed SQL — which meant it
 * needed one specific person, which is the dependency this project exists to remove.
 *
 * Read-only for now. Editing arrives with the opt-in review queue (#21), because
 * that screen already writes to `people` and the question of what may be changed,
 * by whom, and with what audit trail should be answered once rather than twice.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  CONSENT_STATE_LABEL,
  MESSAGEABLE,
  consentState,
  formatPhone,
  type ConsentState,
} from '@/lib/members'

interface PersonRow {
  id: string
  first_name: string
  last_name: string
  status: string
  phone: string | null
  email: string | null
  opt_in_at: string | null
  intro_sent_at: string | null
  opted_out_at: string | null
  sms_never: boolean
}

/**
 * Filters offered above the list, ordered so the two that can be messaged come
 * first. Labels come from CONSENT_STATE_LABEL rather than being written again here,
 * so the directory, the compose audiences and the action buttons cannot drift into
 * describing the same set three different ways.
 */
const FILTER_ORDER: ConsentState[] = [
  'eligible',
  'awaiting_intro',
  'not_opted_in',
  'opted_out',
  'suppressed',
  'no_phone',
]

/** Colour only the two states that need acting on; the rest stay quiet. */
function stateClass(state: ConsentState): string {
  if (state === 'eligible') return 'text-fwm-navy'
  if (state === 'opted_out' || state === 'suppressed') return 'text-fwm-burgundy'
  return 'text-neutral-600'
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>
}) {
  await requireAppUser()
  const { q, filter } = await searchParams
  const db = supabaseAdmin()

  const query = (q ?? '').trim()
  const activeState =
    FILTER_ORDER.find((s) => s === filter) ?? null

  // Everyone, then filtered in memory. At ~300 members that is one small query and
  // no pagination to get wrong; if this club ever reaches thousands, the search
  // moves into the database and this comment becomes the reason why.
  const { data } = await db
    .from('people')
    .select(
      'id, first_name, last_name, status, phone, email, opt_in_at, intro_sent_at, opted_out_at, sms_never'
    )
    .order('last_name')
    .order('first_name')

  const everyone = (data ?? []) as unknown as PersonRow[]

  // Search matches name, phone and email. Phone matching strips punctuation from
  // both sides, so "(530) 555-1234", "5305551234" and "+15305551234" all find the
  // same person — that is how numbers actually get typed.
  const digits = query.replace(/\D/g, '')
  const needle = query.toLowerCase()

  const matches = everyone.filter((p) => {
    if (query) {
      const name = `${p.first_name} ${p.last_name}`.toLowerCase()
      const hitName = name.includes(needle)
      const hitEmail = (p.email ?? '').toLowerCase().includes(needle)
      const hitPhone =
        digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits)
      if (!hitName && !hitEmail && !hitPhone) return false
    }
    if (activeState && consentState(p) !== activeState) return false
    return true
  })

  // Counts for the filter chips, computed over everyone rather than the current
  // result — a filter that says "0" only because of the search term would be
  // misleading.
  const counts = new Map<ConsentState, number>()
  for (const p of everyone) {
    const s = consentState(p)
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-xl font-semibold">Members</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {everyone.length} people. Search by name, phone or email.
      </p>

      {/* One panel, same pattern as the send log: heading, controls and rows inside
          a single surface rather than a stack of separate cards. */}
      <section className="mt-8 overflow-hidden rounded-lg border border-neutral-200 bg-surface dark:border-neutral-800">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">

      {/* A plain form: search lives in the URL, so a result is a shareable link and
          the back button behaves. No client-side JavaScript involved. */}
      <form className="flex gap-2">
        {activeState && <input type="hidden" name="filter" value={activeState} />}
        <input
          name="q"
          defaultValue={query}
          placeholder="Name, phone or email"
          className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
        >
          Search
        </button>
        {query && (
          <Link
            href={activeState ? `/members?filter=${activeState}` : '/members'}
            className="self-center text-sm text-neutral-600 underline"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {/* Everyone: the way back to the whole directory, and the only chip with no
            send action — looking a racer up is half of what this screen is for. */}
        <Link
          href={`/members${query ? `?q=${encodeURIComponent(query)}` : ''}`}
          className={`rounded-full border px-3 py-1 text-sm ${
            activeState === null
              ? 'border-fwm-navy bg-fwm-navy/10 font-medium text-fwm-navy'
              : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400'
          }`}
        >
          Everyone <span className="opacity-60">{everyone.length}</span>
        </Link>

        {FILTER_ORDER.filter((s) => {
          // Hide states nobody is in. "Opted out 0" and "Suppressed 0" are noise
          // until somebody actually texts STOP, and they appear on their own the
          // moment that happens. The active filter always shows, so following a
          // link to an empty state does not lose its own chip.
          if (s === activeState) return true
          return (counts.get(s) ?? 0) > 0
        }).map((s) => {
          const n = counts.get(s) ?? 0
          const active = s === activeState
          const href = `/members?filter=${s}${query ? `&q=${encodeURIComponent(query)}` : ''}`
          return (
            <Link
              key={s}
              href={href}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? 'border-fwm-navy bg-fwm-navy/10 font-medium text-fwm-navy'
                  : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400'
              }`}
            >
              {CONSENT_STATE_LABEL[s]} <span className="opacity-60">{n}</span>
            </Link>
          )
        })}
      </div>

      {/* The send action, offered only for the two states that have opted in.
          Every other filter has no button at all — the absence is the rule, rather
          than a check somewhere that has to be remembered. */}
      {activeState && MESSAGEABLE[activeState] && matches.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-fwm-navy/30 bg-fwm-navy/5 px-4 py-3">
          <Link
            href={`/messages/compose?audience=${MESSAGEABLE[activeState]!.audience}`}
            className="rounded-md bg-fwm-navy px-4 py-2 text-sm font-medium text-white"
          >
            {MESSAGEABLE[activeState]!.action}
          </Link>
          <span className="text-sm text-neutral-600 dark:text-neutral-400">
            {/* The compose screen recomputes the audience, so say so — the number
                here is a snapshot, and someone opting in between the two screens
                should not look like a bug. */}
            Goes to everyone in this state at the moment you send, not to the{' '}
            {counts.get(activeState)} shown here.
          </span>
        </div>
      )}

      </div>

      {matches.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-neutral-600">
          Nobody matches {query ? `“${query}”` : 'that filter'}.
        </p>
      ) : (
        <>
          {/* --- table, on anything wider than a phone --- */}
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/50">
              <tr>
                <th className="px-5 py-2.5 font-medium">Name</th>
                {/* Phone and email are one idea — how to reach them — so they share
                    a column rather than two half-empty ones. */}
                <th className="px-3 py-2.5 font-medium">Contact</th>
                <th className="px-3 py-2.5 font-medium">Member status</th>
                <th className="px-3 py-2.5 font-medium">Texting</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {matches.map((p) => {
                const state = consentState(p)
                return (
                  <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/40">
                    <td className="whitespace-nowrap px-5 py-3 font-medium">
                      {p.first_name} {p.last_name}
                    </td>
                    <td className="px-3 py-3">
                      <span className="block whitespace-nowrap">
                        {formatPhone(p.phone)}
                      </span>
                      {p.email && (
                        <span className="block max-w-xs truncate text-sm text-neutral-600">
                          {p.email}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-neutral-600">
                      {p.status.replace(/_/g, ' ')}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 ${stateClass(state)}`}>
                      {CONSENT_STATE_LABEL[state]}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/members/${p.id}`}
                        className="whitespace-nowrap rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:border-fwm-navy dark:border-neutral-700"
                      >
                        View details
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* --- stacked, on a phone --- */}
          <ul className="divide-y divide-neutral-200 md:hidden dark:divide-neutral-800">
            {matches.map((p) => {
              const state = consentState(p)
              return (
                <li key={p.id}>
                  <Link href={`/members/${p.id}`} className="block px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">
                        {p.first_name} {p.last_name}
                      </span>
                      <span className={`shrink-0 text-sm ${stateClass(state)}`}>
                        {CONSENT_STATE_LABEL[state]}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-neutral-600">
                      {formatPhone(p.phone)}
                      {p.email && ` · ${p.email}`}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {matches.length > 0 && matches.length !== everyone.length && (
        <p className="border-t border-neutral-200 px-5 py-3 text-sm text-neutral-600 dark:border-neutral-800">
          Showing {matches.length} of {everyone.length}.
        </p>
      )}
      </section>
    </main>
  )
}

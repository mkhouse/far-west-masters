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
import { introFailures, withIntroFailures } from '@/lib/intro-failures'
import {
  CONSENT_STATE_LABEL,
  MESSAGEABLE,
  consentState,
  type ConsentState,
} from '@/lib/members'
import { formatPhone } from '@/lib/format'
import {
  MEMBERSHIP,
  applyFilter,
  describeFilter,
  filterFromParams,
  filterToParams,
  type FilterablePerson,
} from '@/lib/member-filters'
import { CopyButton } from './copy-button'
import { UsssaField } from './usssa-field'
import { CopyEmailsButton } from './copy-emails'

interface PersonRow {
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
  /** Derived per request, not stored — see lib/intro-failures.ts. */
  intro_failed?: boolean
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

/**
 * Build a /members URL, dropping empty parameters.
 *
 * Filters combine rather than replace, so every chip has to carry the others'
 * current values — doing that inline produced a thicket of nested template
 * strings that was easy to get subtly wrong.
 */
function qs(params: Record<string, string>): string {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v)
  ).toString()
  return search ? `/members?${search}` : '/members'
}

/** One chip style, so an active filter looks the same wherever it appears. */
function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-sm ${
    active
      ? 'border-fwm-navy bg-fwm-navy/10 font-medium text-fwm-navy'
      : 'border-neutral-300 text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:text-neutral-400'
  }`
}

/** Colour only the two states that need acting on; the rest stay quiet. */
function stateClass(state: ConsentState): string {
  if (state === 'eligible') return 'text-fwm-navy'
  if (state === 'opted_out' || state === 'suppressed') return 'text-fwm-burgundy'
  return 'text-neutral-600'
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    filter?: string
    missing?: string
    membership?: string
  }>
}) {
  await requireAppUser()
  const { q, filter, missing, membership } = await searchParams
  const db = supabaseAdmin()

  // One filter object, shared with the send path. The directory and the audience
  // it produces are computed by the same code — if they diverged, a message would
  // go somewhere other than the list it was chosen from.
  const currentFilter = filterFromParams({ q, filter, missing, membership })
  const { query, texting: activeState, missingUsssa } = currentFilter
  const activeMembership = currentFilter.membership

  // Everyone, then filtered in memory. At ~300 members that is one small query and
  // no pagination to get wrong; if this club ever reaches thousands, the search
  // moves into the database and this comment becomes the reason why.
  const { data } = await db
    .from('people')
    .select(
      'id, first_name, last_name, status, usssa, phone, email, opt_in_at, intro_sent_at, opted_out_at, sms_never'
    )
    .order('last_name')
    .order('first_name')

  // Decorate with failed intros before anything filters or counts, so "needs intro
  // text" and "intro text failed" are separated everywhere on this page rather than
  // in one place and not another.
  const everyone = withIntroFailures(
    (data ?? []) as unknown as PersonRow[],
    await introFailures()
  ) as unknown as PersonRow[]

  const matches = applyFilter(
    everyone as unknown as FilterablePerson[],
    currentFilter
  ) as unknown as PersonRow[]

  const missingUsssaCount = everyone.filter((p) => !p.usssa).length

  const membershipCounts = Object.fromEntries(
    Object.entries(MEMBERSHIP).map(([key, m]) => [
      key,
      everyone.filter((p) => m.statuses.includes(p.status)).length,
    ])
  )

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
        {missingUsssa && <input type="hidden" name="missing" value="usssa" />}
        <input type="hidden" name="membership" value={activeMembership} />
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
            href={qs({
              filter: activeState ?? '',
              missing: missingUsssa ? 'usssa' : '',
              membership: activeMembership,
            })}
            className="self-center px-2 text-sm text-neutral-600 underline"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Two rows, because these are two different questions. Texting state is
          about consent; the second row is about data the club needs for other
          reasons. They combine — "opted in for texts, and cannot race" is a real
          and useful thing to ask for. */}
      <p className="mt-4 text-sm font-medium text-neutral-600">Membership</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(MEMBERSHIP).map(([key, m]) => {
          const active = activeMembership === key
          return (
            <Link
              key={key}
              // Clicking the active chip deselects it and falls back to everyone,
              // like the other two rows. Every chip on this screen behaves the same
              // way, so nobody has to remember which ones toggle.
              href={qs({
                membership: active ? 'all' : key,
                filter: activeState ?? '',
                q: query,
                missing: missingUsssa ? 'usssa' : '',
              })}
              title={active ? 'Clear this filter' : undefined}
              className={chipClass(active)}
            >
              {m.label}{' '}
              <span className="opacity-60">{membershipCounts[key]}</span>
            </Link>
          )
        })}
        <Link
          href={qs({
            membership: 'all',
            filter: activeState ?? '',
            q: query,
            missing: missingUsssa ? 'usssa' : '',
          })}
          className={chipClass(activeMembership === 'all')}
        >
          Everyone <span className="opacity-60">{everyone.length}</span>
        </Link>
      </div>

      <p className="mt-4 text-sm font-medium text-neutral-600">Texting</p>
      {/* No "everyone" chip here: each chip toggles, so no filter selected already
          means all of them. The Membership row above owns the "show me everyone"
          idea, and having it in two places invited the question of which won. */}
      <div className="mt-2 flex flex-wrap gap-2">
        {FILTER_ORDER.filter((s) => {
          // Hide states nobody is in. "Opted out 0" and "Suppressed 0" are noise
          // until somebody actually texts STOP, and they appear on their own the
          // moment that happens. The active filter always shows, so following a
          // link to an empty state does not lose its own chip.
          if (s === activeState) return true
          return (counts.get(s) ?? 0) > 0
        }).map((s) => {
          const active = s === activeState
          return (
            <Link
              key={s}
              // Clicking the active chip clears it. The whole chip is the control —
              // a small × inside a chip is a target you have to aim at, and these
              // get used on a phone.
              href={qs({
                filter: active ? '' : s,
                q: query,
                missing: missingUsssa ? 'usssa' : '',
                membership: activeMembership,
              })}
              title={active ? 'Clear this filter' : undefined}
              className={chipClass(active)}
            >
              {CONSENT_STATE_LABEL[s]}{' '}
              <span className="opacity-60">{counts.get(s) ?? 0}</span>
            </Link>
          )
        })}
      </div>

      <p className="mt-4 text-sm font-medium text-neutral-600">Racing eligibility</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {/* A member without a USSA number cannot race, so this is an action list
            rather than a curiosity. Clicking it again clears it. */}
        <Link
          href={qs({
            filter: activeState ?? '',
            q: query,
            missing: missingUsssa ? '' : 'usssa',
            membership: activeMembership,
          })}
          title={missingUsssa ? 'Clear this filter' : undefined}
          className={chipClass(missingUsssa)}
        >
          Missing USSA number{' '}
          <span className="opacity-60">{missingUsssaCount}</span>
        </Link>
      </div>

      {/* The send action, offered only for the two states that have opted in.
          Every other filter has no button at all — the absence is the rule, rather
          than a check somewhere that has to be remembered.

          And only when the list on screen IS the audience. Narrowing by membership,
          USSA or a search term produces a set the send path cannot express: every
          audience is computed fresh at send time from consent alone. Offering the
          button anyway would mean a button under a list of sixteen that texts
          ninety-three people. */}
      {activeState &&
        MESSAGEABLE[activeState] &&
        (() => {
          const narrowed =
            activeMembership !== 'all' || missingUsssa || query.length > 0

          // Narrowed by membership, USSA or a search: send to exactly this slice.
          // The filter travels as parameters and is re-resolved server-side, so
          // the count below is what the page computed, not what decides delivery.
          const href = narrowed
            ? `/messages/compose?${new URLSearchParams({
                audience: 'filtered',
                ...Object.fromEntries(
                  Object.entries(filterToParams(currentFilter)).filter(([, v]) => v)
                ),
              })}`
            : `/messages/compose?audience=${MESSAGEABLE[activeState]!.audience}`

          return (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-fwm-navy/30 bg-fwm-navy/5 px-4 py-3">
              <Link
                href={href}
                className="rounded-md bg-fwm-navy px-4 py-2 text-sm font-medium text-white"
              >
                {narrowed
                  ? `Message these ${matches.length}`
                  : MESSAGEABLE[activeState]!.action}
              </Link>
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                {/* The audience is recomputed when you send, so someone opting in
                    between these two screens should not look like a bug. */}
                {narrowed
                  ? `${describeFilter(currentFilter)} — recounted when you send.`
                  : `Goes to everyone in this state at the moment you send, which is ${counts.get(activeState)} right now.`}
              </span>
            </div>
          )
        })()}

      </div>

      {matches.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-neutral-600">
          Nobody matches {query ? `“${query}”` : 'that filter'}.
        </p>
      ) : (
        <>
          {/* Above the list, not below it: the count is context for what you are
              about to read, and at the bottom of three hundred rows nobody sees it. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-5 py-2 dark:border-neutral-800">
            <p className="text-sm text-neutral-600">
              Showing <span className="font-medium">{matches.length}</span> of{' '}
              {everyone.length}
            </p>
            {/* Acts on the list as filtered, which is the point — the filters are
                how you build the list you want to email. */}
            <CopyEmailsButton
              emails={matches.map((p) => p.email ?? '').filter(Boolean)}
            />
          </div>

          {/* --- table, on anything wider than a phone --- */}
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/50">
              <tr>
                {/* Row numbers, so a list can be counted and referred to out loud
                    — "the fourth one down" is how people actually talk about it. */}
                <th className="w-12 px-5 py-2.5 text-right font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">Name</th>
                {/* Phone and email are one idea — how to reach them — so they share
                    a column rather than two half-empty ones. */}
                <th className="px-3 py-2.5 font-medium">Contact</th>
                <th className="px-3 py-2.5 font-medium">USSA</th>
                <th className="px-3 py-2.5 font-medium">Member status</th>
                <th className="px-3 py-2.5 font-medium">Texting</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {matches.map((p, i) => {
                const state = consentState(p)
                return (
                  <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/40">
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-400">
                      {i + 1}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-medium">
                      {p.first_name} {p.last_name}
                    </td>
                    <td className="px-3 py-3">
                      <span className="block whitespace-nowrap">
                        {formatPhone(p.phone)}
                        {p.phone && <CopyButton value={p.phone} label="phone number" />}
                      </span>
                      {p.email && (
                        <span className="flex max-w-xs items-center text-sm text-neutral-600">
                          <span className="truncate">{p.email}</span>
                          <CopyButton value={p.email} label="email address" />
                        </span>
                      )}
                    </td>
                    {/* Editable in place: a member without this number cannot
                        race, and the fix should be possible where the gap is
                        noticed rather than on another screen. */}
                    <td className="whitespace-nowrap px-3 py-3">
                      <UsssaField personId={p.id} value={p.usssa} />
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
            {matches.map((p, i) => {
              const state = consentState(p)
              return (
                <li key={p.id}>
                  <Link href={`/members/${p.id}`} className="block px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">
                        <span className="mr-2 tabular-nums font-normal text-neutral-400">
                          {i + 1}
                        </span>
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
                    <p className="mt-0.5 text-sm text-neutral-600">
                      {p.usssa ? `USSA ${p.usssa}` : 'USSA number missing'}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}

      </section>
    </main>
  )
}

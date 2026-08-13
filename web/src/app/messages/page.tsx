/**
 * Messaging console and send log (task #5).
 *
 * This is the audit record. Sending is the only irreversible thing the system does,
 * so the question this page has to answer, months later and without anyone's help,
 * is: who sent what, to whom, and did it arrive.
 *
 * Reaching it at all proves the authorization chain worked — the proxy refreshed the
 * session, the officer is signed in, and `app_users` granted them a role.
 */

import Link from 'next/link'
import { getAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** How many sends to show. FWM sends a few dozen a season; this is years of them. */
const HISTORY_LIMIT = 100

interface MessageRow {
  id: string
  purpose: string | null
  body: string
  category: string | null
  audience_label: string | null
  sent_by: string | null
  status: string
  segments: number | null
  sent_at: string | null
  created_at: string
  bypassed_consent_gate: boolean
}

interface RecipientRow {
  message_id: string
  status: string | null
  delivery_status: string | null
  error: string | null
}

/** Delivery states Twilio reports for a message that never arrived. */
const FAILED_STATES = new Set(['failed', 'undelivered'])

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const appUser = await getAppUser()
  const query = ((await searchParams).q ?? '').trim()

  // The proxy guarantees a signed-in user, but not an authorized one — a valid
  // Supabase login without an `app_users` row lands here.
  if (!appUser) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          You are signed in, but this account has not been granted access. An admin
          needs to add you before you can send messages.
        </p>
      </main>
    )
  }

  const db = supabaseAdmin()

  // Consent-gated audience: the view applies FWM's own rule — a phone number, no
  // opt-out, not suppressed, opted in, and an intro text already sent.
  const { count: eligible } = await db
    .from('sms_eligible_people')
    .select('*', { count: 'exact', head: true })

  const { count: total } = await db
    .from('people')
    .select('*', { count: 'exact', head: true })

  // Drafts are excluded: a message nobody received is not part of the send record.
  let messageQuery = db
    .from('messages')
    .select(
      `id, purpose, body, category, audience_label, sent_by, status, segments,
       sent_at, created_at, bypassed_consent_gate`
    )
    .neq('status', 'draft')

  // Search runs in the database, not over the loaded page.
  //
  // Filtering client-side would have been simpler, but it would only ever have
  // searched the most recent hundred messages — and silently. A search that quietly
  // omits older results is worse than no search, because it answers confidently.
  //
  // `or` with `ilike` across the four fields someone would actually remember: what
  // it was about, what it said, who it went to, who sent it. Commas and parentheses
  // are stripped from the term because they are PostgREST's own filter syntax and
  // would otherwise break the query rather than match anything.
  if (query) {
    const safe = query.replace(/[,()]/g, ' ').trim()
    if (safe) {
      const like = `%${safe}%`
      messageQuery = messageQuery.or(
        `purpose.ilike.${like},body.ilike.${like},audience_label.ilike.${like},sent_by.ilike.${like}`
      )
    }
  }

  const { data: messageData } = await messageQuery
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  const messages = (messageData ?? []) as unknown as MessageRow[]

  // Delivery counts for every listed message in one query, tallied here rather than
  // asking the database once per row. At this volume that is a few hundred rows.
  const { data: recipientData } = messages.length
    ? await db
        .from('message_recipients')
        .select('message_id, status, delivery_status, error')
        .in(
          'message_id',
          messages.map((m) => m.id)
        )
    : { data: [] }

  const tallies = new Map<string, { total: number; delivered: number; failed: number }>()
  for (const r of (recipientData ?? []) as unknown as RecipientRow[]) {
    const t = tallies.get(r.message_id) ?? { total: 0, delivered: 0, failed: 0 }
    t.total += 1
    if (r.delivery_status === 'delivered') t.delivered += 1
    // A send Twilio rejected outright, or one a carrier later bounced. Both mean
    // the text did not arrive, and both need a human to notice.
    if (r.error || FAILED_STATES.has(r.delivery_status ?? '')) t.failed += 1
    tallies.set(r.message_id, t)
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Messages</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Signed in as {appUser.email} ({appUser.role})
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Groups are a messaging idea, so they are linked from here as well as
              from the admin index — this is where someone thinks of them. Shown
              only to admins, because the groups screen requires that role and a
              link that errors is worse than no link. */}
          {/* An outlined button rather than a bare link: it sat next to a filled
              Compose button and read as body text, so it was easy to miss. */}
          {appUser.role === 'admin' && (
            <Link
              href="/admin/groups"
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:border-fwm-navy dark:border-neutral-700 dark:hover:border-fwm-navy"
            >
              Messaging groups
            </Link>
          )}
          <Link
            href="/messages/compose"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Compose
          </Link>
        </div>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
          <dt className="text-neutral-600">People</dt>
          <dd className="mt-1 text-2xl font-semibold">{total ?? '—'}</dd>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800">
          {/* Same words as the members directory. Opt-in is the gate, and saying so
              on every screen is the point. */}
          <dt className="text-neutral-600">Opted-in for texts</dt>
          <dd className="mt-1 text-2xl font-semibold">{eligible ?? '—'}</dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-neutral-600">
        The gap is members who have not opted in, or have not been sent an intro
        text yet.{' '}
        <Link href="/members" className="underline">
          See who and why
        </Link>
        .
      </p>

      {/* One panel holding the heading, the search and the rows, rather than a
          stack of separate cards. With every fact in the same horizontal position
          on every row, the eye tracks down a column instead of re-reading each
          card — which is what makes a long log scannable. */}
      <section className="mt-10 overflow-hidden rounded-lg border border-neutral-200 bg-surface dark:border-neutral-800">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="font-medium text-fwm-navy">Send log</h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Every message this system has sent, who sent it, and what reached a
            phone.
          </p>

          {/* Search lives in the URL, so a result is a shareable link and the back
              button behaves. A plain form — no client-side JavaScript. */}
          <form className="mt-4 flex gap-2">
            <input
              name="q"
              defaultValue={query}
              placeholder="Search messages, audiences or senders"
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
                href="/messages"
                className="self-center px-2 text-sm text-neutral-600 underline"
              >
                Clear
              </Link>
            )}
          </form>
        </div>

        {messages.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-neutral-600">
            {query ? `No messages match “${query}”.` : 'Nothing sent yet.'}
          </p>
        ) : (
          <>
            {/* --- table, on anything wider than a phone --- */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/50">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Message</th>
                  <th className="px-3 py-2.5 font-medium">Sent to</th>
                  <th className="px-3 py-2.5 font-medium">By</th>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  {/* Recipients, segments and delivery are one idea — what happened
                      to this send — so they share a column rather than three. */}
                  <th className="px-3 py-2.5 font-medium">Delivery</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {messages.map((m) => {
                  const t = tallies.get(m.id) ?? { total: 0, delivered: 0, failed: 0 }
                  const when = m.sent_at ?? m.created_at

                  return (
                    <tr key={m.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/40">
                      <td className="max-w-sm px-5 py-3">
                        <span className="block truncate font-medium">
                          {/* Falls back to the message itself when no purpose was
                              typed — better a first line than an empty cell. */}
                          {m.purpose || m.body.split('\n')[0]}
                        </span>
                        {m.bypassed_consent_gate && (
                          <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                            intro text
                          </span>
                        )}
                      </td>
                      {/* Both wrap only as a last resort: a name broken over four
                          lines makes the row taller than everything in it. */}
                      <td className="whitespace-nowrap px-3 py-3 text-neutral-700 dark:text-neutral-300">
                        {m.audience_label ?? 'unknown'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-neutral-700 dark:text-neutral-300">
                        {m.sent_by ?? 'unknown'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-neutral-600">
                        {new Date(when).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span
                          className={
                            t.failed > 0 ? 'font-medium text-fwm-burgundy' : ''
                          }
                        >
                          {t.delivered} of {t.total} delivered
                          {t.failed > 0 && ` · ${t.failed} failed`}
                        </span>
                        <span className="block text-sm text-neutral-600">
                          {m.segments} {m.segments === 1 ? 'segment' : 'segments'}
                          {m.status === 'failed' && ' · send failed'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {/* An explicit button rather than a clickable row: nothing
                            about a row announces that it is interactive. */}
                        <Link
                          href={`/messages/${m.id}`}
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

            {/* --- stacked, on a phone ---
                Six columns do not survive a narrow screen, and officers use this on
                a hill. Same data, one row per line. */}
            <ul className="divide-y divide-neutral-200 md:hidden dark:divide-neutral-800">
              {messages.map((m) => {
                const t = tallies.get(m.id) ?? { total: 0, delivered: 0, failed: 0 }
                const when = m.sent_at ?? m.created_at

                return (
                  <li key={m.id}>
                    <Link href={`/messages/${m.id}`} className="block px-5 py-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate font-medium">
                          {m.purpose || m.body.split('\n')[0]}
                        </span>
                        <span className="shrink-0 text-sm text-neutral-600">
                          {new Date(when).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-neutral-600">
                        {m.audience_label ?? 'unknown'} · sent by{' '}
                        {m.sent_by ?? 'unknown'}
                      </p>
                      <p className="mt-1 text-sm">
                        <span
                          className={
                            t.failed > 0 ? 'font-medium text-fwm-burgundy' : 'text-neutral-600'
                          }
                        >
                          {t.delivered} of {t.total} delivered
                          {t.failed > 0 && ` · ${t.failed} failed`}
                        </span>
                        <span className="text-neutral-600">
                          {' '}
                          · {m.segments} {m.segments === 1 ? 'segment' : 'segments'}
                        </span>
                      </p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {/* Said plainly, because a truncated result set that looks complete is how
            someone concludes a message was never sent. */}
        {messages.length === HISTORY_LIMIT && (
          <p className="border-t border-neutral-200 px-5 py-3 text-sm text-neutral-600 dark:border-neutral-800">
            Showing the first {HISTORY_LIMIT}
            {query
              ? ' matches — narrow the search to see the rest.'
              : ' — search to find older messages.'}
          </p>
        )}
      </section>
    </main>
  )
}

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

export default async function MessagesPage() {
  const appUser = await getAppUser()

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
  const { data: messageData } = await db
    .from('messages')
    .select(
      `id, purpose, body, category, audience_label, sent_by, status, segments,
       sent_at, created_at, bypassed_consent_gate`
    )
    .neq('status', 'draft')
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
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Messages</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Signed in as {appUser.email} ({appUser.role})
          </p>
        </div>
        <Link
          href="/messages/compose"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Compose
        </Link>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <dt className="text-neutral-500">People</dt>
          <dd className="mt-1 text-2xl font-semibold">{total ?? '—'}</dd>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <dt className="text-neutral-500">Can receive a bulk text</dt>
          <dd className="mt-1 text-2xl font-semibold">{eligible ?? '—'}</dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-neutral-500">
        The gap is members who have not opted in, or have not been sent an intro
        text yet, and so cannot receive bulk messages under FWM&rsquo;s consent rule.
      </p>

      <h2 className="mt-12 text-sm font-medium">Send log</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Every message this system has sent, who sent it, and what reached a phone.
      </p>

      {messages.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          Nothing sent yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {messages.map((m) => {
            const t = tallies.get(m.id) ?? { total: 0, delivered: 0, failed: 0 }
            const when = m.sent_at ?? m.created_at

            return (
              <li key={m.id} className="py-4">
                <Link href={`/messages/${m.id}`} className="group block">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="truncate font-medium group-hover:underline">
                      {/* Falls back to the message itself when no purpose was
                          typed — better a first line than an empty row. */}
                      {m.purpose || m.body.split('\n')[0]}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {new Date(when).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-neutral-500">
                    {m.audience_label ?? 'unknown audience'} ·{' '}
                    <span className="text-neutral-700 dark:text-neutral-300">
                      sent by {m.sent_by ?? 'unknown'}
                    </span>
                    {m.category && m.category !== 'general' && ` · ${m.category}`}
                    {m.bypassed_consent_gate && ' · consent gate bypassed'}
                  </p>

                  <p className="mt-1 text-xs text-neutral-500">
                    {t.total} {t.total === 1 ? 'recipient' : 'recipients'}
                    {m.segments ? ` · ${m.segments} seg` : ''}
                    {/* Delivery is asynchronous, so "delivered" lags a send by
                        minutes. Shown only once at least one has confirmed. */}
                    {t.delivered > 0 && ` · ${t.delivered} delivered`}
                    {t.failed > 0 && (
                      <span className="text-red-700 dark:text-red-300">
                        {' '}
                        · {t.failed} failed
                      </span>
                    )}
                    {m.status === 'failed' && (
                      <span className="text-red-700 dark:text-red-300">
                        {' '}
                        · send failed
                      </span>
                    )}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {messages.length === HISTORY_LIMIT && (
        <p className="mt-3 text-xs text-neutral-500">
          Showing the most recent {HISTORY_LIMIT}.
        </p>
      )}
    </main>
  )
}

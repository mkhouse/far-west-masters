/**
 * A sent message and what happened to it.
 *
 * This is the audit record for one send. Two things drive the layout:
 *
 * Delivery is asynchronous — Twilio accepting a message is not the same as a phone
 * receiving it, and a carrier can reject one minutes later. So this shows
 * per-recipient state rather than a single "sent" for the whole thing.
 *
 * And the recipient list is shown in full rather than behind a disclosure control.
 * The question people actually arrive with is "did this reach me", asked about one
 * specific person. Hiding the answer one click away makes the record feel evasive
 * when it is the opposite.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isPermanentFailure } from '@/lib/delivery'

interface RecipientRow {
  phone: string
  status: string | null
  delivery_status: string | null
  error: string | null
  error_code: string | null
  segments: number | null
  people: { first_name: string; last_name: string } | null
}

/**
 * How the audience was chosen, in plain words.
 *
 * The label alone ("Board members") does not say whether that was a maintained
 * list, everyone eligible, or a race's entrants — and those answer different
 * questions when someone asks why they received a text.
 *
 * There is no ad-hoc option here because there is no ad-hoc audience: every send
 * targets something saved. See task #47.
 */
const AUDIENCE_KIND_LABEL: Record<string, string> = {
  group: 'saved group',
  all_eligible: 'all eligible members',
  series: 'race series',
  intro_pending: 'opted in, awaiting intro text',
  opt_in_auto: 'automatic intro, sent by the opt-in form',
  opt_in_review: 'intro sent when an officer approved an opt-in submission',
  // Retained so historical messages still describe themselves. The audience was
  // renamed and rescoped in task #48.
  series_intro: 'intro texts (former series-scoped audience)',
  always: 'always-notify list',
}

/**
 * Colour a delivery state.
 *
 * Only two states earn colour: confirmed arrival and confirmed failure. Everything
 * in between is genuinely unknown and is left grey, because a hopeful green on
 * "queued" would claim something the system does not know yet.
 */
function statusClass(state: string | null): string {
  if (state === 'delivered') return 'text-fwm-navy font-medium'
  if (isPermanentFailure(state)) return 'text-fwm-burgundy font-medium'
  return 'text-neutral-600'
}

export default async function MessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sent?: string; failed?: string }>
}) {
  await requireAppUser()
  const { id } = await params
  const { sent, failed } = await searchParams
  const db = supabaseAdmin()

  // Shape declared explicitly — the concatenated select defeats Supabase's inferred
  // types, and an `any` here would hide a genuine mistake in the column list.
  interface MessageRow {
    body: string
    category: string
    purpose: string | null
    audience_label: string | null
    audience_kind: string | null
    /** Snapshotted at send time — see migration 0017. */
    sent_by: string | null
    status: string
    segments: number | null
    sent_at: string | null
    replies_monitored: boolean
    reply_notice: string | null
    bypassed_consent_gate: boolean
  }

  const { data: messageData } = await db
    .from('messages')
    .select(
      `body, category, purpose, audience_label, audience_kind, sent_by, status,
       segments, sent_at, replies_monitored, reply_notice, bypassed_consent_gate`
    )
    .eq('id', id)
    .single()

  const message = messageData as unknown as MessageRow | null

  if (!message) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-xl font-semibold">Message not found</h1>
        <p className="mt-4 text-sm">
          <Link href="/messages" className="text-fwm-navy underline">
            Back to the send log
          </Link>
        </p>
      </main>
    )
  }

  const { data: recipientData } = await db
    .from('message_recipients')
    .select('phone, status, delivery_status, error, error_code, segments, people(first_name, last_name)')
    .eq('message_id', id)

  const recipients = (recipientData ?? []) as unknown as RecipientRow[]
  const failures = recipients.filter(
    (r) => r.error || isPermanentFailure(r.delivery_status)
  )
  const delivered = recipients.filter((r) => r.delivery_status === 'delivered')

  // Failures first, then everyone else. Sorting the list rather than only calling
  // failures out separately means the thing needing action is never below the fold
  // of a ninety-row list.
  const ordered = [
    ...failures,
    ...recipients.filter((r) => !failures.includes(r)),
  ]

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm">
        <Link href="/messages" className="text-neutral-600 underline">
          &larr; Send log
        </Link>
        <span className="text-neutral-400"> · </span>
        <Link href="/messages/compose" className="text-neutral-600 underline">
          Compose another
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">{message.purpose || 'Message'}</h1>

      {/* Just-sent confirmation. Only appears when arriving from the compose
          screen, and says plainly that acceptance is not delivery. */}
      {sent && (
        <p className="mt-4 rounded-lg border border-fwm-navy/40 bg-fwm-navy/5 p-3 text-sm">
          <strong>{sent}</strong> accepted by Twilio
          {failed && Number(failed) > 0 && (
            <span className="text-fwm-burgundy">
              {' '}
              · <strong>{failed}</strong> failed
            </span>
          )}
          <span className="mt-1 block text-sm text-neutral-600">
            &ldquo;Accepted&rdquo; is not the same as delivered — carriers report
            back over the following minutes.
          </span>
        </p>
      )}

      {/* --- who, what, when: the sent record --- */}
      <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-surface dark:border-neutral-800">
        <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h2 className="text-sm font-medium text-fwm-navy">Sent</h2>
        </div>

        {/* A definition list rather than a sentence: these are the four facts
            someone comes back for, and they should be scannable, not parsed. */}
        <dl className="grid gap-x-6 gap-y-4 px-5 py-4 text-sm sm:grid-cols-2">
          {/* Reached first: it is the outcome, and the reason anyone opens this
              page. To is the input, and answers the follow-up question. */}
          <div>
            <dt className="text-sm uppercase tracking-wide text-neutral-600">
              Reached
            </dt>
            <dd className="mt-0.5 font-medium">
              {delivered.length} of {recipients.length} delivered
              {failures.length > 0 && (
                <span className="text-fwm-burgundy"> · {failures.length} failed</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm uppercase tracking-wide text-neutral-600">To</dt>
            <dd className="mt-0.5 font-medium">
              {message.audience_label ?? 'unknown audience'}
              {/* How the audience was chosen, not just what it was called. */}
              {message.audience_kind && AUDIENCE_KIND_LABEL[message.audience_kind] && (
                <span className="block text-sm font-normal italic text-neutral-600">
                  {AUDIENCE_KIND_LABEL[message.audience_kind]}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm uppercase tracking-wide text-neutral-600">By</dt>
            <dd className="mt-0.5 font-medium">{message.sent_by ?? 'unknown'}</dd>
          </div>
          <div>
            <dt className="text-sm uppercase tracking-wide text-neutral-600">When</dt>
            <dd className="mt-0.5 font-medium">
              {message.sent_at
                ? new Date(message.sent_at).toLocaleString()
                : 'not sent'}
            </dd>
          </div>
        </dl>

        {/* Anything unusual about the send itself, only when it applies. */}
        {(message.bypassed_consent_gate || !message.replies_monitored) && (
          <div className="border-t border-neutral-200 px-5 py-3 text-sm text-neutral-600 dark:border-neutral-800">
            {message.bypassed_consent_gate && (
              <p className="text-amber-700 dark:text-amber-400">
                Intro text — recipients had opted in but not yet been introduced.
                Sending this completed their consent.
              </p>
            )}
            {!message.replies_monitored && <p>Replies were not monitored.</p>}
          </div>
        )}
      </section>

      {/* --- the message itself --- */}
      <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-surface dark:border-neutral-800">
        <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h2 className="text-sm font-medium text-fwm-navy">
            What members received
          </h2>
        </div>
        <div className="px-5 py-4">
          <p className="whitespace-pre-wrap font-mono text-sm">
            {message.body}
            {message.reply_notice && (
              <span className="text-neutral-600"> {message.reply_notice}</span>
            )}
          </p>
          <p className="mt-3 text-sm text-neutral-600">
            {message.segments} {message.segments === 1 ? 'segment' : 'segments'} ·{' '}
            {message.category}
          </p>
        </div>
      </section>

      {/* --- recipients, in full --- */}
      <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-surface dark:border-neutral-800">
        <div className="flex items-baseline justify-between border-b border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h2 className="text-sm font-medium text-fwm-navy">
            Recipients
            <span className="ml-2 font-normal text-neutral-600">
              {recipients.length}
            </span>
          </h2>
          {failures.length > 0 && (
            <span className="text-sm font-medium text-fwm-burgundy">
              {failures.length} did not send
            </span>
          )}
        </div>

        <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          {ordered.map((r) => {
            const isFailure = failures.includes(r)
            return (
              <li
                key={r.phone}
                className={`flex items-baseline justify-between gap-4 px-5 py-2.5 ${
                  isFailure ? 'bg-fwm-burgundy/5' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {r.people
                      ? `${r.people.first_name} ${r.people.last_name}`
                      : r.phone}
                  </span>
                  {/* The reason, not just the fact. "Failed" alone sends someone
                      hunting; error 21610 says they opted out. */}
                  {isFailure && r.error && (
                    <span className="mt-0.5 block text-sm text-fwm-burgundy">
                      {r.error}
                      {r.error_code && ` (${r.error_code})`}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 text-sm ${statusClass(r.delivery_status)}`}
                >
                  {r.delivery_status ?? r.status ?? 'unknown'}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}

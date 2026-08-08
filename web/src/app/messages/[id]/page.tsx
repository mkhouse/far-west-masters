/**
 * A sent message and what happened to it.
 *
 * Delivery is asynchronous — Twilio accepting a message is not the same as a phone
 * receiving it, and a carrier can reject one minutes later. So this shows the
 * per-recipient state rather than a single "sent" for the whole thing.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface RecipientRow {
  phone: string
  status: string | null
  delivery_status: string | null
  error: string | null
  error_code: string | null
  segments: number | null
  people: { first_name: string; last_name: string } | null
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
      `body, category, purpose, audience_label, sent_by, status, segments, sent_at,
       replies_monitored, reply_notice, bypassed_consent_gate`
    )
    .eq('id', id)
    .single()

  const message = messageData as unknown as MessageRow | null

  if (!message) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-xl font-semibold">Message not found</h1>
      </main>
    )
  }

  const { data: recipientData } = await db
    .from('message_recipients')
    .select('phone, status, delivery_status, error, error_code, segments, people(first_name, last_name)')
    .eq('message_id', id)

  const recipients = (recipientData ?? []) as unknown as RecipientRow[]
  const failures = recipients.filter((r) => r.error)

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm">
        <Link href="/messages" className="text-neutral-500 underline">
          &larr; Send log
        </Link>
        <span className="text-neutral-400"> · </span>
        <Link href="/messages/compose" className="text-neutral-500 underline">
          Compose another
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">
        {message.purpose || 'Message'}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Sent to {message.audience_label}
        {/* Attribution comes first among the details: for the one irreversible
            action here, "who" is the question people actually come asking. */}
        {' by '}
        <span className="text-neutral-700 dark:text-neutral-300">
          {message.sent_by ?? 'unknown'}
        </span>
        {message.sent_at && ` · ${new Date(message.sent_at).toLocaleString()}`}
      </p>

      {sent && (
        <p className="mt-4 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <strong>{sent}</strong> accepted by Twilio
          {failed && Number(failed) > 0 && (
            <span className="text-red-700 dark:text-red-300">
              {' '}
              · <strong>{failed}</strong> failed
            </span>
          )}
          <span className="mt-1 block text-xs text-neutral-500">
            &ldquo;Accepted&rdquo; is not the same as delivered — carriers report
            back over the following minutes.
          </span>
        </p>
      )}

      <section className="mt-6 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="whitespace-pre-wrap font-mono text-sm">
          {message.body}
          {message.reply_notice && (
            <span className="text-neutral-500"> {message.reply_notice}</span>
          )}
        </p>
        <p className="mt-3 text-xs text-neutral-500">
          {message.segments}{' '}
          {message.segments === 1 ? 'segment' : 'segments'} · {recipients.length}{' '}
          recipients
          {!message.replies_monitored && ' · replies not monitored'}
          {message.bypassed_consent_gate && ' · consent gate bypassed'}
        </p>
      </section>

      {/* Failures first: they are the only part anyone needs to act on. */}
      {failures.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-red-700 dark:text-red-300">
            {failures.length} did not send
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {failures.map((r) => (
              <li key={r.phone} className="text-neutral-600 dark:text-neutral-400">
                {r.people ? `${r.people.first_name} ${r.people.last_name}` : r.phone} —{' '}
                {r.error}
                {r.error_code && ` (${r.error_code})`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="mt-6">
        <summary className="cursor-pointer text-sm text-neutral-500">
          All {recipients.length} recipients
        </summary>
        <ul className="mt-2 space-y-1 text-sm">
          {recipients.map((r) => (
            <li key={r.phone} className="flex justify-between">
              <span>
                {r.people ? `${r.people.first_name} ${r.people.last_name}` : r.phone}
              </span>
              <span className="text-neutral-500">
                {r.delivery_status ?? r.status ?? 'unknown'}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </main>
  )
}

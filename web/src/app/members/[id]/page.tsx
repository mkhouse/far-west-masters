/**
 * One member: who they are, whether they can be texted and why, and everything the
 * club has said to them.
 *
 * The question this exists to answer is "why isn't Jane getting texts", and the
 * honest answer is usually one of five things. So the consent state leads, with the
 * specific blocking reason stated rather than left to be inferred from five
 * timestamps.
 *
 * Read-only. Editing arrives with the opt-in review queue (#21), together with the
 * audit trail those fields need.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  CONSENT_STATE_DETAIL,
  CONSENT_STATE_LABEL,
  consentState,
  formatPhone,
} from '@/lib/members'

interface PersonRow {
  id: string
  first_name: string
  last_name: string
  nickname: string | null
  status: string
  gender: string | null
  yob: number | null
  usssa: number | null
  phone: string | null
  email: string | null
  sms_always: boolean
  sms_never: boolean
  opt_in_at: string | null
  intro_sent_at: string | null
  opted_out_at: string | null
  notes: string | null
}

/** A date, or a plain dash. Times are noise at this level of detail. */
function day(ts: string | null): string {
  return ts ? new Date(ts).toLocaleDateString() : '—'
}

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAppUser()
  const { id } = await params
  const db = supabaseAdmin()

  const { data: personData } = await db
    .from('people')
    .select(
      `id, first_name, last_name, nickname, status, gender, yob, usssa, phone, email,
       sms_always, sms_never, opt_in_at, intro_sent_at, opted_out_at, notes`
    )
    .eq('id', id)
    .maybeSingle()

  const person = personData as unknown as PersonRow | null
  if (!person) notFound()

  const state = consentState(person)

  // Everything the club has sent them, and everything they have said back. Both are
  // part of answering "what happened with this member" — a reply is often the reason
  // someone is asking.
  const [{ data: groupRows }, { data: sentRows }, { data: replyRows }] =
    await Promise.all([
      db
        .from('recipient_group_members')
        .select('recipient_groups(id, name)')
        .eq('person_id', id),
      db
        .from('message_recipients')
        .select(
          'message_id, delivery_status, status, error, sent_at, messages(purpose, body, sent_at)'
        )
        .eq('person_id', id)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .limit(25),
      db
        .from('inbound_messages')
        .select('body, received_at, is_stop')
        .eq('person_id', id)
        .order('received_at', { ascending: false })
        .limit(10),
    ])

  const groups = (groupRows ?? []).map(
    (r) => (r as unknown as { recipient_groups: { id: string; name: string } | null }).recipient_groups
  ).filter(Boolean) as Array<{ id: string; name: string }>

  const sent = (sentRows ?? []) as unknown as Array<{
    message_id: string
    delivery_status: string | null
    status: string | null
    error: string | null
    messages: { purpose: string | null; body: string; sent_at: string | null } | null
  }>

  const replies = (replyRows ?? []) as unknown as Array<{
    body: string
    received_at: string
    is_stop: boolean
  }>

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm">
        <Link href="/members" className="text-neutral-500 underline">
          &larr; Members
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">
        {person.first_name} {person.last_name}
        {person.nickname && (
          <span className="ml-2 text-base font-normal text-neutral-500">
            &ldquo;{person.nickname}&rdquo;
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        {person.status.replace(/_/g, ' ')}
        {person.yob && ` · born ${person.yob}`}
        {person.usssa && ` · USSA ${person.usssa}`}
      </p>

      {/* --- can they be texted, and why --- */}
      <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
        <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h2 className="text-sm font-medium text-fwm-navy">Texting</h2>
        </div>
        <div className="px-5 py-4">
          <p
            className={`text-sm font-medium ${
              state === 'eligible'
                ? 'text-fwm-navy'
                : state === 'opted_out' || state === 'suppressed'
                  ? 'text-fwm-burgundy'
                  : ''
            }`}
          >
            {CONSENT_STATE_LABEL[state]}
          </p>
          <p className="mt-1 text-sm text-neutral-500">{CONSENT_STATE_DETAIL[state]}</p>

          {/* The underlying dates, so the summary above can be checked rather than
              taken on trust. */}
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Phone</dt>
              <dd className="mt-0.5">{formatPhone(person.phone)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Email</dt>
              <dd className="mt-0.5">{person.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">
                Opted in
              </dt>
              <dd className="mt-0.5">{day(person.opt_in_at)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">
                Intro sent
              </dt>
              <dd className="mt-0.5">{day(person.intro_sent_at)}</dd>
            </div>
            {person.opted_out_at && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">
                  Opted out
                </dt>
                <dd className="mt-0.5 text-fwm-burgundy">{day(person.opted_out_at)}</dd>
              </div>
            )}
            {person.sms_always && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-neutral-500">
                  Always notify
                </dt>
                <dd className="mt-0.5">Wants race texts regardless of entry</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      {/* --- groups --- */}
      {groups.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900/50">
            <h2 className="text-sm font-medium text-fwm-navy">Groups</h2>
          </div>
          <ul className="flex flex-wrap gap-2 px-5 py-4 text-sm">
            {groups.map((g) => (
              <li
                key={g.id}
                className="rounded-full border border-neutral-300 px-3 py-1 text-xs dark:border-neutral-700"
              >
                {g.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- what they have been sent --- */}
      <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
        <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          <h2 className="text-sm font-medium text-fwm-navy">
            Messages sent
            <span className="ml-2 font-normal text-neutral-500">{sent.length}</span>
          </h2>
        </div>
        {sent.length === 0 ? (
          <p className="px-5 py-4 text-sm text-neutral-500">
            Nothing has been sent to this member yet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {sent.map((s) => (
              <li key={s.message_id} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
                <Link href={`/messages/${s.message_id}`} className="min-w-0 hover:underline">
                  <span className="block truncate">
                    {s.messages?.purpose || s.messages?.body?.split('\n')[0] || 'Message'}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {day(s.messages?.sent_at ?? null)}
                  </span>
                </Link>
                <span
                  className={`shrink-0 text-xs ${
                    s.delivery_status === 'delivered'
                      ? 'text-fwm-navy'
                      : s.error
                        ? 'text-fwm-burgundy'
                        : 'text-neutral-500'
                  }`}
                >
                  {s.delivery_status ?? s.status ?? 'unknown'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- what they have said back --- */}
      {replies.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-900/50">
            <h2 className="text-sm font-medium text-fwm-navy">Replies</h2>
          </div>
          <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {replies.map((r, i) => (
              <li key={i} className="px-5 py-2.5">
                <p className={r.is_stop ? 'font-medium text-fwm-burgundy' : ''}>
                  {r.body}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {new Date(r.received_at).toLocaleString()}
                  {r.is_stop && ' · treated as opt-out'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {person.notes && (
        <section className="mt-6 rounded-lg border border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-medium text-fwm-navy">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">{person.notes}</p>
        </section>
      )}
    </main>
  )
}

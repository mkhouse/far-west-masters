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
import {
  pacificDate,
  validPreviewDate,
  visibleWeekend,
} from '@/lib/race-weekends'
import { daysAgo, loadSendLog } from '@/lib/send-log'
import { loadWeekendRaces } from '@/lib/race-weekend-data'
import { RaceDayBlock } from './race-day-block'
import { SendLog } from './send-log'

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>
}) {
  const appUser = await getAppUser()
  const params = await searchParams
  const previewDate = validPreviewDate(params.preview)

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

  // THE CONSOLE SHOWS A WEEK. It answers "what has just gone out"; a year of
  // scrolling answers a different question, and that one now has its own page.
  const { messages, tallies, truncated } = await loadSendLog({ since: daysAgo(7) })

  const today = previewDate ?? pacificDate()
  const weekend = visibleWeekend(await loadWeekendRaces(), today)

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      {/* ABOVE THE HEADING, DELIBERATELY. `/` redirects here, so this is the
          first thing on screen after signing in — and on a race weekend it is
          the only thing most people need. See race-day-block.tsx. */}
      {/* LOUD, BECAUSE THE BUTTONS BELOW ARE REAL. The audience a preview
          builds is a genuine one, so from a March preview somebody could
          compose and send to people about a race months away. Burgundy, which
          here means a thing could go wrong rather than has. */}
      {previewDate && (
        <p className="mb-6 rounded-md border border-fwm-burgundy/40 bg-fwm-burgundy/5 px-4 py-3 text-sm text-fwm-burgundy">
          <strong>Previewing as {previewDate}. This is not today.</strong> The
          buttons below still text real people.{' '}
          <Link href="/messages" className="underline">
            Back to today
          </Link>
          .
        </p>
      )}

      {weekend && <RaceDayBlock weekend={weekend} today={today} />}

      {previewDate && !weekend && (
        <p className="mb-6 text-sm text-neutral-600">
          No race weekend would show on {previewDate}.
        </p>
      )}

      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Messages</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Signed in as {appUser.name ? `${appUser.name} · ` : ''}
            {appUser.email} ({appUser.role})
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

      <SendLog
        messages={messages}
        tallies={tallies}
        truncated={truncated}
        title="Sent this week"
        subtitle="The last seven days. Everything older is in the full send log."
        emptyText="Nothing sent in the past week."
        footer={
          <p className="border-t border-neutral-200 px-5 py-3 text-sm dark:border-neutral-800">
            <Link href="/messages/log" className="font-medium text-fwm-navy underline">
              Full send log
            </Link>
            <span className="text-neutral-600">
              {' '}
              &mdash; everything this system has sent, and the search.
            </span>
          </p>
        }
      />
    </main>
  )
}


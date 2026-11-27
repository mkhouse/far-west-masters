/**
 * The full send record.
 *
 * Split off the messages console, which now shows the last week: that screen
 * answers "what has just gone out", and it was also being asked to be a year of
 * scrolling. This page is the other question — the audit trail, and the only
 * place with a search, because searching inside a single week answers nothing.
 *
 * The rows and the loading are shared with the console. See lib/send-log.ts.
 */

import Link from 'next/link'
import { getAppUser } from '@/lib/auth'
import { loadSendLog } from '@/lib/send-log'
import { SendLog } from '../send-log'

export default async function SendLogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const appUser = await getAppUser()

  // The proxy guarantees a signed-in user, but not an authorized one.
  if (!appUser) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          You are signed in, but this account has not been granted access.
        </p>
      </main>
    )
  }

  const query = ((await searchParams).q ?? '').trim()
  const { messages, tallies, truncated } = await loadSendLog({ query })

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-sm">
        <Link href="/messages" className="text-neutral-600 underline">
          &larr; Messages
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">Send log</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Every message this system has sent, who sent it, and what reached a
        phone.
      </p>

      <SendLog
        messages={messages}
        tallies={tallies}
        truncated={truncated}
        title="All messages"
        subtitle="Newest first. Sending is the only irreversible thing this system does, so nothing is ever removed from here."
        emptyText={query ? `No messages match “${query}”.` : 'Nothing sent yet.'}
        search={{ action: '/messages/log', query }}
      />
    </main>
  )
}

/**
 * The send log's rows, shared by the messages console and the full log page.
 *
 * One panel holding the heading, the optional search and the rows, rather than
 * a stack of separate cards. With every fact in the same horizontal position on
 * every row, the eye tracks down a column instead of re-reading each card —
 * which is what makes a long log scannable.
 *
 * Rendered twice with different data, never written twice: see lib/send-log.ts.
 */

import Link from 'next/link'
import { SEND_LOG_LIMIT, type DeliveryTally, type SendLogMessage } from '@/lib/send-log'

export function SendLog({
  messages,
  tallies,
  truncated,
  title,
  subtitle,
  emptyText,
  /** Shown only on the full log — searching inside one week answers nothing. */
  search,
  footer,
}: {
  messages: SendLogMessage[]
  tallies: Map<string, DeliveryTally>
  truncated: boolean
  title: string
  subtitle: string
  emptyText: string
  search?: { action: string; query: string }
  footer?: React.ReactNode
}) {
  return (
    <section className="mt-10 overflow-hidden rounded-lg border border-neutral-200 bg-surface dark:border-neutral-800">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="font-medium text-fwm-navy">{title}</h2>
        <p className="mt-0.5 text-sm text-neutral-600">{subtitle}</p>

        {/* Search lives in the URL, so a result is a shareable link and the back
            button behaves. A plain form — no client-side JavaScript. */}
        {search && (
          <form className="mt-4 flex gap-2" action={search.action}>
            <input
              name="q"
              defaultValue={search.query}
              placeholder="Search messages, audiences or senders"
              className="flex-1 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
            >
              Search
            </button>
            {search.query && (
              <Link
                href={search.action}
                className="self-center px-2 text-sm text-neutral-600 underline"
              >
                Clear
              </Link>
            )}
          </form>
        )}
      </div>

      {messages.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-neutral-600">{emptyText}</p>
      ) : (
        <>
          {/* --- table, on anything wider than a phone --- */}
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/50">
              {/* DATE FIRST. The log is read in time order and scanned for
                  "when did that go out" before anything else; the date was the
                  fourth column, so the eye had to cross three to find it. */}
              <tr>
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Message</th>
                <th className="px-3 py-2.5 font-medium">Sent to</th>
                <th className="px-3 py-2.5 font-medium">By</th>
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
                    <td className="whitespace-nowrap px-5 py-3 text-neutral-600">
                      {new Date(when).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="max-w-sm px-3 py-3">
                      <span className="block truncate font-medium">
                        {/* Falls back to the message itself when no purpose was
                            typed — better a first line than an empty cell. */}
                        {m.purpose || m.body.split('\n')[0]}
                      </span>
                      {/* Teal, not amber. This is a label for what the send was,
                          on a send that worked — nothing is wrong and nothing is
                          owed. */}
                      {m.bypassed_consent_gate && (
                        <span className="mt-1 inline-block rounded bg-fwm-teal/15 px-1.5 py-0.5 text-sm text-fwm-teal-text">
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
                    <td className="whitespace-nowrap px-3 py-3">
                      <span className={t.failed > 0 ? 'font-medium text-fwm-burgundy' : ''}>
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
                      {m.audience_label ?? 'unknown'} · sent by {m.sent_by ?? 'unknown'}
                    </p>
                    <p className="mt-1 text-sm">
                      <span
                        className={
                          t.failed > 0
                            ? 'font-medium text-fwm-burgundy'
                            : 'text-neutral-600'
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
      {truncated && (
        <p className="border-t border-neutral-200 px-5 py-3 text-sm text-neutral-600 dark:border-neutral-800">
          Showing the first {SEND_LOG_LIMIT} — search to find older messages.
        </p>
      )}

      {footer}
    </section>
  )
}

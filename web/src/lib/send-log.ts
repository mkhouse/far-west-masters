import 'server-only'

/**
 * The send record, loaded once and rendered in two places.
 *
 * This is the audit trail. The question it has to answer, months later and
 * without anyone's help, is: who sent what, to whom, and did it arrive.
 *
 * It appears twice — the last week on the messages console, the whole history
 * on its own page — and the loading lives here rather than in either page so
 * the two cannot drift. Two copies of a log that must agree is precisely how
 * they stop agreeing.
 */

import { supabaseAdmin } from './supabase/admin'

/** How many rows a single view will load. FWM sends a few dozen a season. */
export const SEND_LOG_LIMIT = 100

export interface SendLogMessage {
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

export interface DeliveryTally {
  total: number
  delivered: number
  failed: number
}

interface RecipientRow {
  message_id: string
  status: string | null
  delivery_status: string | null
  error: string | null
}

/** Delivery states Twilio reports for a message that never arrived. */
const FAILED_STATES = new Set(['failed', 'undelivered'])

export interface SendLog {
  messages: SendLogMessage[]
  tallies: Map<string, DeliveryTally>
  /** True when the limit was reached, so the view can say so rather than imply completeness. */
  truncated: boolean
}

/**
 * @param since ISO timestamp. Only messages at or after it — the console shows
 *              a week, because a console answering "what has just gone out"
 *              should not also be a year of scrolling.
 * @param query Free text across what somebody would actually remember.
 */
export async function loadSendLog({
  since,
  query,
}: {
  since?: string
  query?: string
} = {}): Promise<SendLog> {
  const db = supabaseAdmin()

  // Drafts are excluded: a message nobody received is not part of the record.
  let messageQuery = db
    .from('messages')
    .select(
      `id, purpose, body, category, audience_label, sent_by, status, segments,
       sent_at, created_at, bypassed_consent_gate`
    )
    .neq('status', 'draft')

  if (since) messageQuery = messageQuery.gte('created_at', since)

  // SEARCH RUNS IN THE DATABASE, not over the loaded page. Filtering client-side
  // would have been simpler, but it would only ever have searched the most
  // recent hundred messages — and silently. A search that quietly omits older
  // results is worse than no search, because it answers confidently.
  //
  // Commas and parentheses are stripped because they are PostgREST's own filter
  // syntax and would break the query rather than match anything.
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
    .limit(SEND_LOG_LIMIT)

  const messages = (messageData ?? []) as unknown as SendLogMessage[]

  // Delivery counts for every listed message in one query, tallied here rather
  // than asking the database once per row.
  const { data: recipientData } = messages.length
    ? await db
        .from('message_recipients')
        .select('message_id, status, delivery_status, error')
        .in(
          'message_id',
          messages.map((m) => m.id)
        )
    : { data: [] }

  const tallies = new Map<string, DeliveryTally>()
  for (const r of (recipientData ?? []) as unknown as RecipientRow[]) {
    const t = tallies.get(r.message_id) ?? { total: 0, delivered: 0, failed: 0 }
    t.total += 1
    if (r.delivery_status === 'delivered') t.delivered += 1
    // An error OR a terminal failure state. Twilio reports both, and either means
    // the text did not arrive, and both need a human to notice.
    if (r.error || FAILED_STATES.has(r.delivery_status ?? '')) t.failed += 1
    tallies.set(r.message_id, t)
  }

  return { messages, tallies, truncated: messages.length === SEND_LOG_LIMIT }
}

/** An ISO timestamp `days` before now, for the console's window. */
export function daysAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

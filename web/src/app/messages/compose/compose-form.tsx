'use client'

/**
 * Message composer.
 *
 * The important behaviour here is cost visibility. SMS bills per segment per
 * recipient, so the difference between a 288-character message and a 289-character
 * one is nearly three hundred extra messages — invisible unless the screen says so.
 *
 * Length rules and their reasoning: migration/sms-limits.md
 */

import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { sendMessage } from './send'
import {
  additionsLength,
  checkSendability,
  composeBody,
  countEmoji,
  fixSmartCharacters,
  remainingNonGsmCharacters,
} from '@/lib/sms/segments'

export interface Officer {
  id: string
  name: string
  phone: string
}

export interface ComposeSettings {
  warnSegments: number
  maxSegments: number
  maxEmoji: number
  /** Opt-out line appended to every message. Empty only if Twilio adds its own. */
  optOutText: string
  defaultReplyNotice: string
  /** Estimated USD per outbound segment — see app_settings, verify against invoices */
  costPerSegmentUsd: number
}

/**
 * Format an estimated cost.
 *
 * Always shown with a `~` and the word "est." Rates vary by carrier and volume, so
 * presenting this as an exact figure would be misleading — it is here to inform a
 * decision, not to reconcile against a bill.
 *
 * Sub-cent amounts show as `<$0.01` rather than rounding to `$0.00`, which would
 * read as free.
 */
function formatEstimatedCost(dollars: number): string {
  if (dollars === 0) return '$0.00'
  if (dollars < 0.01) return '<$0.01'
  return `~$${dollars.toFixed(2)}`
}

const CATEGORIES = [
  { value: 'race', label: 'Race' },
  { value: 'membership', label: 'Membership' },
  { value: 'general', label: 'General' },
  { value: 'intro', label: 'Intro / consent' },
] as const

export interface AudienceOption {
  kind: string
  series?: string
  groupId?: string
  label: string
}

export interface AudienceResult {
  kind: string
  label: string
  recipientCount: number
  consideredCount: number
  excluded: { reason: string; count: number }[]
  bypassesConsentGate: boolean
  unavailableReason?: string
}

export function ComposeForm({
  officers,
  settings,
  categoryDefaults,
  audiences,
  audience,
  selectedSeries,
  selectedGroupId,
}: {
  officers: Officer[]
  settings: ComposeSettings
  /** category -> officer id, so picking a category pre-selects who answers */
  categoryDefaults: Record<string, string>
  audiences: AudienceOption[]
  audience: AudienceResult
  selectedSeries?: string
  selectedGroupId?: string
}) {
  const recipientCount = audience.recipientCount
  const [category, setCategory] = useState<string>('general')
  const [body, setBody] = useState('')
  const [repliesMonitored, setRepliesMonitored] = useState(true)
  const [replyNotice, setReplyNotice] = useState(settings.defaultReplyNotice)
  const [replyTo, setReplyTo] = useState<string>(categoryDefaults.general ?? '')
  const [autoFixed, setAutoFixed] = useState<string[]>([])

  /**
   * Smart punctuation is corrected as it is typed or pasted, rather than offered as
   * a prompt. The correction lands in the box, so what is on screen is what will be
   * sent — and a prompt would not help anyway, since the offending character is
   * invisible.
   */
  function handleBodyChange(next: string) {
    const { text, replaced, changed } = fixSmartCharacters(next)
    setBody(text)
    setAutoFixed(changed ? replaced : [])
  }

  /** Changing category moves the reply contact to whoever normally handles it. */
  function handleCategoryChange(next: string) {
    setCategory(next)
    const preferred = categoryDefaults[next]
    if (preferred) setReplyTo(preferred)
  }

  // Everything the app adds after the sender stops typing, and still charges them
  // for: the opt-out line on every message, plus the reply notice when replies are
  // not being watched.
  const additions = useMemo(
    () => ({
      replyNotice: repliesMonitored ? null : replyNotice,
      optOutText: settings.optOutText,
    }),
    [repliesMonitored, replyNotice, settings.optOutText]
  )

  // The message exactly as it will arrive. Shown below, and measured here — one
  // function builds both, so the counter cannot promise something the send breaks.
  const composed = useMemo(() => composeBody(body, additions), [body, additions])

  const verdict = useMemo(
    () =>
      checkSendability(body, recipientCount, {
        appendedLength: additionsLength(body, additions),
        warnSegments: settings.warnSegments,
        maxSegments: settings.maxSegments,
        maxEmoji: settings.maxEmoji,
      }),
    [body, recipientCount, additions, settings]
  )

  const specialChars = useMemo(() => remainingNonGsmCharacters(body), [body])
  const emoji = countEmoji(body)
  const canSend = body.trim().length > 0 && !verdict.blocked && recipientCount > 0

  return (
    <form action={sendMessage} className="space-y-6">
      {/* The audience travels with the form, but the server re-resolves it from
          these keys rather than trusting any recipient list from the browser. */}
      <input type="hidden" name="audience_kind" value={audience.kind} />
      <input type="hidden" name="group_id" value={selectedGroupId ?? ''} />
      <input type="hidden" name="series" value={selectedSeries ?? ''} />
      {/* --- who this goes to; first, because it changes everything below --- */}
      <AudiencePicker
        audiences={audiences}
        audience={audience}
        selectedSeries={selectedSeries}
        selectedGroupId={selectedGroupId}
      />

      <section className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Category</span>
          <select
            name="category"
            value={category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Replies go to</span>
          <select
            name="reply_person_id"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          >
            <option value="">Default forwarding number</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* --- reply handling --- */}
      <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={!repliesMonitored}
            onChange={(e) => setRepliesMonitored(!e.target.checked)}
            className="mt-1"
          />
          {/* The action reads the positive form; the checkbox shows the negative
              because "nobody is watching" is the exceptional case worth ticking. */}
          <input type="hidden" name="replies_monitored" value={repliesMonitored ? 'on' : ''} />
          <span className="text-sm">
            <span className="font-medium">Nobody is watching for replies</span>
            <span className="mt-0.5 block text-neutral-500">
              Replies are still received and logged, but not forwarded to anyone&rsquo;s
              phone. Each person who replies gets one automatic acknowledgement.
              STOP still works.
            </span>
          </span>
        </label>

        {!repliesMonitored && (
          <label className="mt-3 block">
            <span className="text-sm font-medium">
              Notice added to the message
              <span className="ml-2 font-normal text-neutral-500">
                {replyNotice.length} characters
              </span>
            </span>
            <input
              name="reply_notice"
              value={replyNotice}
              onChange={(e) => setReplyNotice(fixSmartCharacters(e.target.value).text)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </label>
        )}
      </section>

      {/* Short label stored with the message. Cheap to type, and it is what makes
          the log readable months later. */}
      <label className="block">
        <span className="text-sm font-medium">
          Purpose <span className="font-normal text-neutral-500">(for the log)</span>
        </span>
        <input
          name="purpose"
          placeholder="Sugar Bowl start times"
          className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
      </label>

      {/* --- message --- */}
      <section>
        <label className="block">
          <span className="text-sm font-medium">Message</span>
          <textarea
            name="body"
            value={body}
            onChange={(e) => handleBodyChange(e.target.value)}
            rows={6}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-neutral-700"
            placeholder="Sugar Bowl SL starts at 9am. Bib pickup opens 8am at the lodge."
          />
        </label>

        {autoFixed.length > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Adjusted for SMS: {autoFixed.join(', ')} replaced with plain equivalents.
          </p>
        )}

        {/* The message as it will actually arrive. A counter can be argued with;
            seeing the reply notice and the opt-out line in place cannot. */}
        {body.trim() && (
          <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
            <p className="text-xs font-medium text-neutral-500">
              What arrives on the phone
            </p>
            <p className="mt-2 whitespace-pre-wrap font-mono text-sm">
              {body.trim()}
              {/* The additions greyed, so it is obvious which words the sender
                  typed and which the system is adding on their behalf. */}
              <span className="text-neutral-500">
                {composed.slice(body.trim().length)}
              </span>
            </p>
          </div>
        )}
      </section>

      {/* --- cost, always visible --- */}
      <CostSummary
        verdict={verdict}
        recipientCount={recipientCount}
        specialChars={specialChars}
        emoji={emoji}
        maxEmoji={settings.maxEmoji}
        costPerSegmentUsd={settings.costPerSegmentUsd}
        typedLength={body.length}
      />

      <SendButton canSend={canSend} recipientCount={recipientCount} />
    </form>
  )
}

/**
 * The Send button, and the pending state that matters more than it does.
 *
 * A send to ninety people takes minutes: a single Twilio number emits roughly one
 * segment per second, and the action does not return until it has worked through
 * the list. For that whole time the page looks idle.
 *
 * Left as an ordinary button, a second click starts a SECOND send — a new message
 * with the same audience, every member texted twice, at double the cost. The
 * per-recipient unique index does not help: it prevents duplicates within one
 * message, and this would be two.
 *
 * So while sending, the button is replaced rather than disabled. There is nothing
 * left to click.
 */
function SendButton({
  canSend,
  recipientCount,
}: {
  canSend: boolean
  recipientCount: number
}) {
  const { pending } = useFormStatus()

  if (pending) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
      >
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Sending to {recipientCount} {recipientCount === 1 ? 'person' : 'people'}…
      </div>
    )
  }

  return (
    <button
      type="submit"
      disabled={!canSend}
      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
    >
      {recipientCount === 0
        ? 'No recipients'
        : `Send to ${recipientCount} ${recipientCount === 1 ? 'person' : 'people'}`}
    </button>
  )
}

/**
 * The cost panel.
 *
 * Leads with total messages rather than characters, because that is the number with
 * consequences. A character count alone lets someone add one word and triple the
 * bill without noticing.
 */
function CostSummary({
  verdict,
  recipientCount,
  specialChars,
  emoji,
  maxEmoji,
  costPerSegmentUsd,
  typedLength,
}: {
  verdict: ReturnType<typeof checkSendability>
  recipientCount: number
  specialChars: string[]
  emoji: number
  maxEmoji: number
  costPerSegmentUsd: number
  /** Characters the sender actually typed, excluding anything appended */
  typedLength: number
}) {
  const { info, totalMessages, warn, blocked, reason } = verdict

  // Per-recipient cost stays meaningful with no audience loaded, where a total of
  // $0.00 would read as "sending is free" rather than "there is nobody to send to".
  const perRecipient = info.segments * costPerSegmentUsd
  const total = totalMessages * costPerSegmentUsd
  const hasAudience = recipientCount > 0

  const tone = blocked
    ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
    : warn
      ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
      : 'border-neutral-200 dark:border-neutral-800'

  return (
    <section className={`rounded-lg border p-4 text-sm ${tone}`}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        {hasAudience ? (
          <>
            <span>
              <strong>{info.segments}</strong>{' '}
              {info.segments === 1 ? 'segment' : 'segments'} × {recipientCount} ={' '}
              <strong>{totalMessages}</strong> messages
            </span>
            <span title="Approximate. Rates vary by carrier and volume; excludes monthly number and registration fees.">
              <strong>{formatEstimatedCost(total)}</strong>{' '}
              <span className="text-neutral-500">
                est. &middot; {formatEstimatedCost(perRecipient)} each
              </span>
            </span>
          </>
        ) : (
          <>
            <span>
              <strong>{info.segments}</strong>{' '}
              {info.segments === 1 ? 'segment' : 'segments'} per recipient
            </span>
            <span title="Approximate. Rates vary by carrier and volume; excludes monthly number and registration fees.">
              <strong>{formatEstimatedCost(perRecipient)}</strong>{' '}
              <span className="text-neutral-500">est. each &middot; no recipients yet</span>
            </span>
          </>
        )}
        {/* Count what was typed, not the total including appended text. The total
            is what determines segments, but showing it here reads as though the
            box already has content when it is empty. */}
        <span className="text-neutral-500">
          {typedLength} {typedLength === 1 ? 'character' : 'characters'} &middot;{' '}
          {info.remainingInSegment} left in this segment
        </span>
      </div>

      {/* Explain a shrunken budget rather than treating its cause as an error —
          emoji and accents are allowed. */}
      {info.forcedUcs2 && (
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          {specialChars.slice(0, 6).join(' ')} {specialChars.length > 6 && '…'} —
          these reduce the limit from 160 to 70 characters per segment.
        </p>
      )}

      {emoji > 0 && (
        <p className="mt-1 text-neutral-500">
          {emoji} of {maxEmoji} emoji
        </p>
      )}

      {reason && (
        <p
          className={`mt-2 font-medium ${
            blocked ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-200'
          }`}
        >
          {reason}
        </p>
      )}
    </section>
  )
}

/**
 * Who the message goes to.
 *
 * Placed first on the form, and deliberately verbose about exclusions. "93 people"
 * on its own looks identical whether the club has 93 members or 293 — showing the
 * gap, and why, is what stops the consent gate silently shrinking a send with
 * nobody noticing.
 *
 * Navigates rather than holding local state: the recipient count and exclusion
 * reasons are computed on the server against live data, so the audience lives in
 * the URL and the page re-renders with real numbers rather than an estimate.
 */
function AudiencePicker({
  audiences,
  audience,
  selectedSeries,
  selectedGroupId,
}: {
  audiences: AudienceOption[]
  audience: AudienceResult
  selectedSeries?: string
  selectedGroupId?: string
}) {
  const value =
    audience.kind === 'group'
      ? `group|${selectedGroupId ?? ''}`
      : audience.kind + (selectedSeries ? `|${selectedSeries}` : '')

  return (
    <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <label className="block">
        <span className="text-sm font-medium">Send to</span>
        <select
          value={value}
          onChange={(e) => {
            const [kind, arg] = e.target.value.split('|')
            const params = new URLSearchParams({ audience: kind })
            if (kind === 'group' && arg) params.set('group', arg)
            else if (arg) params.set('series', arg)
            window.location.search = params.toString()
          }}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        >
          {audiences.map((a) => (
            <option
              key={a.kind + (a.groupId ?? a.series ?? '')}
              value={
                a.kind === 'group'
                  ? `group|${a.groupId}`
                  : a.kind + (a.series ? `|${a.series}` : '')
              }
            >
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 text-sm">
        {audience.unavailableReason ? (
          <p className="text-amber-700 dark:text-amber-300">
            {audience.unavailableReason}
          </p>
        ) : (
          <p>
            <strong>{audience.recipientCount}</strong>{' '}
            {audience.recipientCount === 1 ? 'person' : 'people'}
            {audience.consideredCount > audience.recipientCount && (
              <span className="text-neutral-500">
                {' '}
                of {audience.consideredCount} considered
              </span>
            )}
          </p>
        )}

        {/* Naming each exclusion turns an unexplained number into an actionable
            one — "31 have not opted in" is something someone can do something
            about. */}
        {audience.excluded.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-neutral-500">
            {audience.excluded.map((e) => (
              <li key={e.reason}>
                {e.count} excluded &mdash; {e.reason}
              </li>
            ))}
          </ul>
        )}

        {audience.bypassesConsentGate && (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            This audience does not apply the usual consent gate. Intro texts reach
            people who have not yet opted in — that is how they opt in — and test
            sends reach the test group directly.
          </p>
        )}
      </div>
    </section>
  )
}

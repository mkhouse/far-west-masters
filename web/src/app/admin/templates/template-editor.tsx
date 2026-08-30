'use client'

/**
 * Write or edit one template.
 *
 * Shows the segment count as you type, and never refuses a long message. That is the
 * deliberate difference from the compose screen, where a third segment multiplies
 * across three hundred recipients and is worth blocking. A template is sent to one
 * person at a time, so its cost is one message — the count is information, not a
 * limit. Refusing a 264-character template would refuse most of the ones FWM
 * actually uses.
 *
 * What it does enforce is encoding. Smart punctuation is replaced as it is typed, the
 * same as the compose box, because a curly apostrophe saved into a template is a
 * permanent 2.5x multiplier on every send that uses it.
 */

import { useMemo, useState } from 'react'
import {
  analyseMessage,
  fixSmartCharacters,
  remainingNonGsmCharacters,
} from '@/lib/sms/segments'
import {
  PLACEHOLDERS,
  TEMPLATE_CATEGORIES,
  findPlaceholders,
  unknownPlaceholders,
} from '@/lib/templates'

export function TemplateEditor({
  action,
  templateId,
  initialName = '',
  initialCategory = 'new_member',
  initialBody = '',
  submitLabel,
}: {
  action: (formData: FormData) => void
  templateId?: string
  initialName?: string
  initialCategory?: string
  initialBody?: string
  submitLabel: string
}) {
  const [name, setName] = useState(initialName)
  const [body, setBody] = useState(initialBody)
  const [autoFixed, setAutoFixed] = useState<string[]>([])

  function handleBody(next: string) {
    const { text, replaced, changed } = fixSmartCharacters(next)
    setBody(text)
    setAutoFixed(changed ? replaced : [])
  }

  // The opt-out line is appended to every message the app sends, so a template's real
  // cost includes it. Measuring the body alone would under-report by 18 characters,
  // which is exactly enough to move a message across a segment boundary.
  const OPT_OUT_LENGTH = 18
  const info = useMemo(() => analyseMessage(body, OPT_OUT_LENGTH), [body])
  const used = useMemo(() => findPlaceholders(body), [body])
  const unknown = useMemo(() => unknownPlaceholders(body), [body])
  const special = useMemo(() => remainingNonGsmCharacters(body), [body])

  return (
    <form action={action} className="space-y-4">
      {templateId && <input type="hidden" name="template_id" value={templateId} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <span className="mt-0.5 block text-sm text-neutral-600">
            How you will find it in the picker. Members never see it.
          </span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bib pickup"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Kind</span>
          <span className="mt-0.5 block text-sm text-neutral-600">
            Groups the picker, and says what the message is for.
          </span>
          <select
            name="category"
            defaultValue={initialCategory}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          >
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium">Message</span>
        <textarea
          name="body"
          value={body}
          onChange={(e) => handleBody(e.target.value)}
          rows={6}
          placeholder="Hi {first name}, meet me between {time} at {venue}…"
          className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-neutral-700"
        />
      </label>

      {autoFixed.length > 0 && (
        <p className="text-sm text-neutral-600">
          Adjusted for SMS: {autoFixed.join(', ')} replaced with plain equivalents.
          These force every segment down from 160 characters to 70, so this saves real
          money on every send.
        </p>
      )}

      {/* Cost, stated and not enforced. */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/50">
        <p>
          <strong>{info.segments}</strong>{' '}
          {info.segments === 1 ? 'segment' : 'segments'}{' '}
          <span className="text-neutral-600">
            · {body.length} characters, plus {OPT_OUT_LENGTH} for the opt-out line
          </span>
        </p>
        <p className="mt-1 text-neutral-600">
          Filling in the blanks makes the real message longer than this. Sent to one
          person at a time, so length is your call — there is no limit here.
        </p>
        {info.forcedUcs2 && (
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            {special.slice(0, 6).join(' ')} — these cut every segment from 160
            characters to 70.
          </p>
        )}
      </div>

      {/* What this template will ask for when somebody uses it. */}
      <div className="rounded-lg border border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800">
        <p className="font-medium">Blanks in this message</p>
        {used.length === 0 ? (
          <p className="mt-1 text-neutral-600">
            None. It will send exactly as written — which is fine for a message that
            answers a question rather than opening a conversation.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {used.map((name) => (
              <li key={name}>
                <code>{`{${name}}`}</code>{' '}
                <span className="text-neutral-600">
                  {PLACEHOLDERS[name]?.description ??
                    'Not a placeholder this system knows — it would be sent as written.'}
                </span>
              </li>
            ))}
          </ul>
        )}

        {unknown.length > 0 && (
          <p className="mt-2 font-medium text-red-700 dark:text-red-300">
            {unknown.map((u) => `{${u}}`).join(', ')} cannot be filled in and will not
            save. Use one of the placeholders below, or write the words out.
          </p>
        )}

        <details className="mt-2">
          <summary className="cursor-pointer text-neutral-600">
            What can go in a blank
          </summary>
          <ul className="mt-2 space-y-1">
            {Object.entries(PLACEHOLDERS).map(([key, spec]) => (
              <li key={key}>
                <code>{`{${key}}`}</code>{' '}
                <span className="text-neutral-600">{spec.description}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <button
        type="submit"
        disabled={!name.trim() || !body.trim() || unknown.length > 0}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        {submitLabel}
      </button>
    </form>
  )
}

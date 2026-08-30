'use client'

/**
 * Pick a saved template, and fill in its blanks.
 *
 * Two jobs, and the second is the one that earns the component. Choosing a template
 * is a dropdown; what makes templates usable is that the message then still contains
 * `{venue}` and `{time}`, and the officer has to be walked through closing those gaps
 * before the send button will do anything.
 *
 * The design rule throughout: an unfilled blank stays visible in the message and the
 * send stays blocked. Nothing here ever quietly drops a placeholder to make the
 * message look finished.
 */

import { useMemo, useState, useTransition } from 'react'
import { saveContactPhone } from '@/app/account/actions'
import { formatPhone } from '@/lib/format'
import { fixSmartCharacters } from '@/lib/sms/segments'
import {
  PLACEHOLDERS,
  categoryLabel,
  fillTemplate,
  findPlaceholders,
  hasPerMemberPlaceholder,
  type MessageTemplate,
} from '@/lib/templates'

/** Mirrors lib/races.ts, flattened for the client — no server import in a bundle. */
export interface RaceOption {
  id: string
  venue: string
  label: string
}

export function TemplatePicker({
  templates,
  races,
  officerName,
  officerPhone,
  onOfficerPhoneSaved,
  body,
  onBodyChange,
  recipientCount,
}: {
  templates: MessageTemplate[]
  /** Races left in the current season. Empty until the schedule is loaded (#6). */
  races: RaceOption[]
  /** The officer's first name, for {officer name}. */
  officerName: string | null
  /** E.164, or null when they have not published one. */
  officerPhone: string | null
  onOfficerPhoneSaved: (e164: string) => void
  body: string
  onBodyChange: (next: string) => void
  recipientCount: number
}) {
  const [selectedId, setSelectedId] = useState('')
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const selected = templates.find((t) => t.id === selectedId)

  // Read the blanks from the CURRENT message, not from the template that produced it.
  // The officer can edit the body afterwards — deleting a sentence, or typing a venue
  // over the placeholder by hand — and the list of what is left must follow what is
  // actually there rather than what the template originally said.
  const remaining = useMemo(() => findPlaceholders(body), [body])

  const officerValues = useMemo(
    () => ({
      'officer name': officerName ?? '',
      // Formatted, not E.164. A member reading "+15305551234" off a text has to
      // decode it before they can dial it.
      'officer phone': officerPhone ? formatPhone(officerPhone) : '',
    }),
    [officerName, officerPhone]
  )

  /** Insert a template, filling everything already known about the officer. */
  function choose(id: string) {
    setSelectedId(id)
    setTyped({})
    if (!id) return

    const template = templates.find((t) => t.id === id)
    if (!template) return

    const { text } = fillTemplate(template.body, officerValues)
    onBodyChange(text)
  }

  /** Apply whatever the officer has typed into the blank fields. */
  function fillBlanks() {
    const { text } = fillTemplate(body, typed)
    onBodyChange(text)
    setTyped({})
  }

  /**
   * Save the contact number and fill it in, without leaving the message.
   *
   * The alternative — a link to /account and back — loses the audience, the category
   * and anything already typed, to fix something the officer only found out about
   * because the send stopped. One field, in place, once.
   */
  function savePhone() {
    setPhoneError(null)
    startSaving(async () => {
      const result = await saveContactPhone(phoneInput)
      if (!result.ok) {
        setPhoneError(result.error)
        return
      }
      onOfficerPhoneSaved(result.phone)
      setPhoneInput('')
      // Fill it into the message that is already on screen. Re-running fillTemplate
      // over the current body touches only this placeholder — anything the officer
      // has typed in the meantime is left alone.
      const { text } = fillTemplate(body, {
        'officer phone': formatPhone(result.phone),
      })
      onBodyChange(text)
    })
  }

  if (templates.length === 0) return null

  const needsPhone = remaining.includes('officer phone')
  // A race placeholder becomes a plain text field when the schedule is empty, which
  // it is until #6 lands. Blocking a message on an unpopulated table would be absurd.
  const raceBlanks = remaining.filter(
    (name) => PLACEHOLDERS[name]?.source === 'race' && races.length > 0
  )
  const typedBlanks = remaining.filter(
    (name) =>
      PLACEHOLDERS[name]?.source === 'typed' ||
      (PLACEHOLDERS[name]?.source === 'race' && races.length === 0)
  )
  const unknown = remaining.filter((name) => !(name in PLACEHOLDERS))
  const perMemberOnBulk =
    recipientCount > 1 && hasPerMemberPlaceholder(body)

  return (
    <section className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
      <label className="block">
        <span className="text-sm font-medium">Start from a template</span>
        <select
          value={selectedId}
          onChange={(e) => choose(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        >
          <option value="">Write from scratch</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {categoryLabel(t.category)} — {t.name}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <p className="mt-2 text-sm text-neutral-600">
          Filled into the message below, where you can edit it. Nothing is sent until
          you press Send.
        </p>
      )}

      {/* --- a template that addresses one person, aimed at many --- */}
      {perMemberOnBulk && (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          This message addresses someone by name, and this audience has{' '}
          {recipientCount} people in it. One message goes to everybody, so there is no
          per-person name to fill in — these templates are for contacting one member at
          a time. Remove the name, or pick a single recipient.
        </p>
      )}

      {/* --- the officer's own number, set here rather than elsewhere --- */}
      {needsPhone && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            This template gives the member a number to call, and you have not set one.
          </p>
          <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
            It is not taken from your member record on purpose — that is where the club
            texts you, and it has never been given to members. Set the number you are
            happy for members to call. It is saved to your account, so this is a
            one-off.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="(530) 555-1234"
              className="w-48 rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              onClick={savePhone}
              disabled={saving || !phoneInput.trim()}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              {saving ? 'Saving…' : 'Save and fill in'}
            </button>
          </div>

          {phoneError && (
            <p className="mt-2 font-medium text-red-700 dark:text-red-300" role="alert">
              {phoneError}
            </p>
          )}
        </div>
      )}

      {/* --- which race, from the schedule --- */}
      {raceBlanks.length > 0 && (
        <div className="mt-3 rounded-lg border border-neutral-200 px-3 py-3 dark:border-neutral-800">
          <p className="text-sm font-medium">Which race?</p>
          <p className="mt-0.5 text-sm text-neutral-600">
            Races left this season. Picking one fills it into the message straight
            away.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {raceBlanks.map((name) => (
              <label key={name} className="block">
                <span className="text-sm">{name}</span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const race = races.find((r) => r.id === e.target.value)
                    if (!race) return
                    // Fill immediately. Choosing from a list is already a deliberate
                    // act; making them then press a second button to confirm it is
                    // ceremony, and the result is visible in the message below.
                    const { text } = fillTemplate(body, { [name]: race.venue })
                    onBodyChange(text)
                  }}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
                >
                  <option value="">Choose a race…</option>
                  {races.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            Somewhere not on the schedule? Type over the placeholder in the message
            below.
          </p>
        </div>
      )}

      {/* --- venue, time, and anything else typed per send --- */}
      {typedBlanks.length > 0 && (
        <div className="mt-3 rounded-lg border border-neutral-200 px-3 py-3 dark:border-neutral-800">
          <p className="text-sm font-medium">Fill in the blanks</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {typedBlanks.map((name) => (
              <label key={name} className="block">
                <span className="text-sm">{name}</span>
                <span className="mt-0.5 block text-sm text-neutral-600">
                  {PLACEHOLDERS[name].description}
                </span>
                <input
                  value={typed[name] ?? ''}
                  onChange={(e) =>
                    setTyped((prev) => ({
                      ...prev,
                      // Cleaned on the way in, exactly as the message box is. A venue
                      // pasted from a schedule can carry an en dash.
                      [name]: fixSmartCharacters(e.target.value).text,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={fillBlanks}
            disabled={!Object.values(typed).some((v) => v.trim())}
            className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-neutral-700"
          >
            Fill in
          </button>
        </div>
      )}

      {/* --- a placeholder nothing knows how to fill --- */}
      {unknown.length > 0 && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {unknown.map((u) => `{${u}}`).join(', ')}{' '}
          {unknown.length === 1 ? 'is not something' : 'are not things'} the system can
          fill in. Type over{' '}
          {unknown.length === 1 ? 'it' : 'them'} in the message below, or remove{' '}
          {unknown.length === 1 ? 'it' : 'them'}.
        </p>
      )}
    </section>
  )
}

'use client'

/**
 * The one-tap route from opening the app to texting the people racing.
 *
 * Melissa, 2026-11-27, on what this tool is actually for: "if someone is on the
 * slopes and it's snowing and needs to message a delay or change it needs to be
 * super easy to do", and it has to work for "someone who may not be interested
 * in the rest of the features".
 *
 * So the shape is deliberate:
 *
 *   - **The big button needs no decisions.** Everyone racing this weekend, one
 *     tap, straight to a composed screen. Someone who uses nothing else in this
 *     app can do their whole job with it.
 *   - **Days, not races, are the unit.** "Everyone racing Saturday" is what a
 *     delay affects. A day with two Super-Gs is one chip.
 *   - **Picking one race is possible but folded away.** It matters when only
 *     the second run is late, and it is clutter every other time — so it is one
 *     tap behind a disclosure, and only appears when a day has more than one
 *     race.
 *   - **Nothing is prefilled.** The message is always empty: Melissa writes in
 *     her own voice, and a ready-made text one tap from Send is how thirty
 *     people get an accident.
 *
 * Nothing here sends. Every path lands on the compose screen with the audience
 * chosen, where the count is re-derived server-side and Send is still a
 * deliberate act.
 */

import Link from 'next/link'
import { useState } from 'react'
import {
  entrantsOf,
  racesOnDays,
  reachOf,
  shortDay,
  weekendLabel,
  type RaceWeekend,
} from '@/lib/race-weekends'

export function RaceDayBlock({
  weekend,
  today,
}: {
  weekend: RaceWeekend
  /** 'YYYY-MM-DD' in Pacific, from the server. */
  today: string
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [showRaces, setShowRaces] = useState(false)

  const allRaces = weekend.days.flatMap((d) => d.races)

  /**
   * ONE BUTTON, WHICH CHANGES. Picking a day used to add a SECOND "Text …"
   * button below the first, so the block offered two sends at once and the
   * reader had to work out which was which. The chips narrow who the one
   * button is for; they are not another way to send.
   *
   * With nothing picked it means the whole weekend — the common case, and the
   * reason this block exists at all.
   */
  const sending = picked.length > 0 ? racesOnDays(weekend, picked) : allRaces
  const sendable = sending.filter((r) => r.entrantPersonIds.length > 0)
  const reach = reachOf(sending)
  const entered = entrantsOf(sending)
  const sendingLabel =
    picked.length > 0
      ? picked
          .slice()
          .sort()
          .map((d) => shortDay(d))
          .join(' + ')
      : 'this weekend'

  // `quick=1` asks the compose screen for the simple form: a message box, the
  // audience, and nothing else. See compose-form.tsx.
  const href = (ids: string[]) =>
    `/messages/compose?audience=race&races=${ids.join(',')}&quick=1`

  const anyDayHasTwoRaces = weekend.days.some((d) => d.races.length > 1)
  const withEntries = allRaces.filter((r) => r.entrantPersonIds.length > 0)
  const withoutEntries = allRaces.filter((r) => r.entrantPersonIds.length === 0)

  function toggleDay(date: string) {
    setPicked((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]
    )
  }

  return (
    /* A CARD, NOT A CALLOUT. Amber's left rule means "something is waiting for
       you" (see CLAUDE.md) and this is not that — it is the tool, and on a race
       weekend it is the main thing on the page. So it takes the amber as a card
       in its own right, with a title, rather than borrowing the caution shape. */
    <section className="mb-8 rounded-lg border border-fwm-amber/30 bg-fwm-amber/10 px-4 py-4 sm:px-5">
      <h2 className="text-base font-semibold text-fwm-amber-text">Quick compose</h2>
      <p className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-300">
        <span className="font-medium">
          {weekend.days.some((d) => d.date === today)
            ? 'Racing today'
            : 'Racing this weekend'}
        </span>
        {' · '}
        {weekendLabel(weekend)}
        {weekend.venues.length > 0 ? ` · ${weekend.venues.join(', ')}` : ''}
      </p>

      {/* THE ONE TAP. Big, first, and needing no decision — sized for a gloved
          thumb rather than a mouse. */}
      {reach > 0 ? (
        /* NO BARE NUMBERS ANYWHERE. This used to carry a count on its own, and
           so did the chips — "Sun 6  27" read as part of the date. Every number
           now sits inside the sentence that says what it counts. */
        <Link
          href={href(sendable.map((r) => r.id))}
          className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-fwm-navy px-4 py-3.5 text-base font-medium text-white hover:bg-fwm-navy/90 dark:text-neutral-950"
        >
          {/* "the 28 racing" was untrue — 45 are racing and 28 have opted in.
              Both numbers, so the sentence is honest and the opt-in gap is
              visible on the screen where it actually costs the club something. */}
          <span>
            Text {reach} of the {entered} racing {sendingLabel}
          </span>
          <span className="shrink-0">&rarr;</span>
        </Link>
      ) : (
        <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
          Nobody racing this weekend can be texted yet.
        </p>
      )}

      {/* SAYS THE RULE, NOT JUST THE ARITHMETIC. "28 of the 45" shows there is
          a gap; this says what the gap is, next to the button rather than on
          some other screen. The club's whole posture is that consent is the
          gate, and the race-day block is the one place somebody might press a
          button without having read anything else. */}
      {reach > 0 && (
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          Only racers who have opted in for texts are included.
        </p>
      )}

      {weekend.days.length > 1 && (
        <>
          <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">
            Or pick days
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {weekend.days.map((day) => {
              const on = picked.includes(day.date)
              const reach = reachOf(day.races)
              // Words, not a zero. A day with nobody reachable is worth saying
              // out loud, and selecting it could not change the count — so it
              // says why instead of offering a tap that does nothing.
              if (reach === 0) {
                return (
                  <span
                    key={day.date}
                    className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-600 dark:border-neutral-700"
                  >
                    {shortDay(day.date)} &middot; nobody yet
                  </span>
                )
              }
              return (
                <button
                  key={day.date}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(day.date)}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${
                    on
                      ? 'bg-fwm-navy text-white dark:text-neutral-950'
                      : 'border border-fwm-navy/40 text-fwm-navy'
                  }`}
                >
                  {shortDay(day.date)}
                  {day.date === today ? ' · today' : ''}
                </button>
              )
            })}
          </div>

        </>
      )}

      {/* FOLDED AWAY ON PURPOSE. Only useful when one race of a two-race day is
          the one running late; clutter on every other day of the season. */}
      {anyDayHasTwoRaces && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowRaces((v) => !v)}
            className="text-sm text-neutral-600 underline"
          >
            {showRaces ? 'Hide single races' : 'One race only'}
          </button>
          {showRaces && (
            <ul className="mt-2 space-y-1">
              {withEntries.map((r) => (
                <li key={r.id}>
                  <Link
                    href={href([r.id])}
                    className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm dark:border-neutral-800"
                  >
                    <span>
                      {shortDay(r.date)} &middot; {r.name}
                    </span>
                    <span className="shrink-0 text-neutral-600">
                      {reachOf([r])} of {r.entrantPersonIds.length} &rarr;
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* SHOWN, NOT OMITTED. A race quietly missing from this block is the worst
          thing it could do — the officer would text "everyone racing" and reach
          nobody from that race without ever knowing it existed. */}
      {withoutEntries.length > 0 && (
        <p className="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
          {withoutEntries.length === 1
            ? 'One race this weekend has no entries imported'
            : `${withoutEntries.length} races this weekend have no entries imported`}
          {' — '}
          {withoutEntries.map((r) => shortDay(r.date)).join(', ')}.{' '}
          <Link href="/admin/entries" className="font-medium text-fwm-navy underline">
            Import the roster
          </Link>
          .
        </p>
      )}
    </section>
  )
}

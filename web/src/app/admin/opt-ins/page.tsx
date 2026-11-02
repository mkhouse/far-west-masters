/**
 * Opt-in submissions waiting for a decision.
 *
 * The public form matches on phone number and holds anything it cannot place. Until
 * this page existed those submissions were invisible: somebody consented to receive
 * texts, was thanked, and then heard nothing, with nothing anywhere to say so.
 *
 * This matters more as the club pushes the form harder. Somebody joining is
 * registering with AdminSkiRacing at that moment, so they are genuinely not in
 * `people` yet — the very people the form is best at reaching are the ones who
 * arrive unmatched.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { listPending } from '@/lib/opt-in-review'
import { describeWait, waiting } from '@/lib/waiting'
import { formatPhone } from '@/lib/format'
import { SubmissionList } from './submission-list'

export default async function OptInReviewPage() {
  await requireAppUser()
  const [pending, w] = await Promise.all([listPending(), waiting()])

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm">
        <Link href="/admin" className="text-neutral-600 underline">
          &larr; Admin
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">Opt-ins needing action</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Everyone who has consented and is waiting on the club. Three things can hold
        somebody here, and they need different answers &mdash; a decision, a text, or
        a phone call.
      </p>

      {w.total === 0 ? (
        <p className="mt-8 rounded-lg border border-neutral-200 bg-surface p-4 text-sm text-neutral-600 dark:border-neutral-800">
          Nobody is waiting. Everyone who has opted in has had their intro text.
        </p>
      ) : null}

      {/* --- 1. needs a decision --- */}
      <section className="mt-10">
        <h2 className="font-medium">
          Waiting for a decision
          {w.pendingReview > 0 && (
            <span className="ml-2 font-normal text-neutral-600">
              {w.pendingReview}
            </span>
          )}
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Filled in the form and could not be matched to a member automatically.
          Approving one sends their intro text, which is what completes their consent.
        </p>

        <SubmissionList pending={pending} />
      </section>

      {/* --- 2. needs a text --- */}
      {w.awaitingIntro.length > 0 && (
        <section className="mt-10">
          <h2 className="font-medium">
            Waiting for their intro text
            <span className="ml-2 font-normal text-neutral-600">
              {w.awaitingIntro.length}
            </span>
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            They opted in and the club has never replied. Until the intro goes out
            they are in no ordinary audience, so they hear nothing at all &mdash;
            which is why they can sit here unnoticed for a very long time.
          </p>

          <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {w.awaitingIntro.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
              >
                <Link
                  href={`/members/${p.id}`}
                  className="font-medium text-fwm-navy underline"
                >
                  {p.firstName} {p.lastName}
                </Link>
                <span className="text-neutral-600">
                  {formatPhone(p.phone)} &middot; waiting{' '}
                  <strong className="font-medium">{describeWait(p.optInAt)}</strong>
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-sm">
            <Link
              href="/messages/compose?audience=intro_pending"
              className="text-fwm-navy underline"
            >
              Send the intro text to all {w.awaitingIntro.length}
            </Link>
            <span className="text-neutral-600">
              {' '}&mdash; the wording is prefilled, and you still press Send.
            </span>
          </p>
        </section>
      )}

      {/* --- 3. needs a different channel --- */}
      {w.introFailed.length > 0 && (
        <section className="mt-10">
          <h2 className="font-medium">
            Intro text failed &mdash; bad number
            <span className="ml-2 font-normal text-neutral-600">
              {w.introFailed.length}
            </span>
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            The club tried and a carrier permanently rejected it &mdash; a landline
            given as a mobile, or a digit mistyped. <strong>Sending again will not
            work.</strong> These people have opted in and want to hear from the club;
            the number is the problem, so somebody has to reach them another way and
            get a working mobile.
          </p>

          <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-amber-300 dark:divide-neutral-800 dark:border-amber-900">
            {w.introFailed.map((p) => (
              <li key={p.id} className="px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <Link
                    href={`/members/${p.id}`}
                    className="font-medium text-fwm-navy underline"
                  >
                    {p.firstName} {p.lastName}
                  </Link>
                  <span className="text-neutral-600">
                    tried {formatPhone(p.phone)} &middot; waiting{' '}
                    {describeWait(p.optInAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-neutral-600">
                  {p.email ? (
                    <a href={`mailto:${p.email}`} className="underline">
                      {p.email}
                    </a>
                  ) : (
                    'No email on file either — they will need a phone call.'
                  )}
                  {p.failureReason ? ` · ${p.failureReason}` : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Said once, here, rather than assumed. Whoever picks this up next should know
          why they are being asked to click rather than the system just doing it. */}
      <p className="mt-10 text-sm text-neutral-600">
        Submissions are reviewed by a person on purpose. A public form that created
        member records and sent texts on its own would be a way to make the club text
        any number somebody typed into it.
      </p>
    </main>
  )
}

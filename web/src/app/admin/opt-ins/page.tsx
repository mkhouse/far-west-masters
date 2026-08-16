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
import { SubmissionList } from './submission-list'

export default async function OptInReviewPage() {
  await requireAppUser()
  const pending = await listPending()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm">
        <Link href="/admin" className="text-neutral-600 underline">
          &larr; Admin
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">Opt-in submissions</h1>
      <p className="mt-1 text-sm text-neutral-600">
        People who filled in the form and could not be matched to a member
        automatically. Approving one sends their intro text, which is what completes
        their consent.
      </p>

      <SubmissionList pending={pending} />

      {/* Said once, here, rather than assumed. Whoever picks this up next should know
          why they are being asked to click rather than the system just doing it. */}
      <p className="mt-8 text-sm text-neutral-600">
        Submissions are reviewed by a person on purpose. A public form that created
        member records and sent texts on its own would be a way to make the club text
        any number somebody typed into it.
      </p>
    </main>
  )
}

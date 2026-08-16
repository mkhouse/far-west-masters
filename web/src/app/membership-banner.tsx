/**
 * "The membership list is out of date."
 *
 * Members join throughout the season, so a fortnight-old import means new members
 * are missing from the directory and from every audience — and nothing about that
 * failure is visible. Somebody who paid last week simply is not there, and the club
 * texts around them.
 *
 * Only in season. Renewals open around 15 October and racing ends about 1 April;
 * outside that nothing changes, and a warning nobody needs is one people learn to
 * ignore, which would cost more than it saves.
 *
 * BE HONEST ABOUT THE LIMIT: nobody sees a banner if nobody opens the app. A real
 * alert — a text or an email when the import goes stale — needs a scheduled job,
 * which does not exist yet. This is the version that works today, not the version
 * that catches everything.
 */

import Link from 'next/link'
import type { ImportFreshness } from '@/lib/membership'

export function MembershipBanner({ freshness }: { freshness: ImportFreshness }) {
  if (!freshness.stale) return null

  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
      <p className="font-medium">
        {freshness.isFallback
          ? `No memberships imported for ${freshness.currentSeason} yet`
          : freshness.daysOld === null
            ? 'No membership list has been imported'
            : `The membership list is ${freshness.daysOld} days old`}
      </p>

      <p className="mt-1 text-neutral-700 dark:text-neutral-300">
        {freshness.isFallback ? (
          <>
            Showing <strong>{freshness.season}</strong> instead. Membership renews
            every year, so nobody counts as current until the new season is imported —
            anyone who has renewed is missing from the directory and from every
            audience until then.
          </>
        ) : (
          <>
            People join all season. Anyone who joined since the last import is missing
            from the directory and from every audience, and nothing else will say so.
          </>
        )}
      </p>

      <p className="mt-2">
        <Link href="/admin/membership" className="text-fwm-navy underline">
          Import the latest export
        </Link>
      </p>
    </div>
  )
}

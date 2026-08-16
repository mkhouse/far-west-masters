/**
 * Importing membership from AdminSkiRacing.
 *
 * Membership originates there — a lapsed member becomes active by joining, with its
 * own fee — so this system imports the answer rather than keeping one of its own,
 * which it had been doing badly: measured against the 2025-2026 export, 63 people
 * carried the wrong status.
 *
 * The export is downloaded again every few weeks through the season to catch new
 * members, and each download holds everyone rather than just the additions. So a
 * repeat import should change almost nothing, and this page is arranged around
 * showing that: the interesting number is what changed, not what is in the file.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { membershipContext } from '@/lib/membership'
import { ImportForm } from './import-form'

export default async function MembershipImportPage() {
  await requireAppUser()

  const { display, freshness } = await membershipContext()
  const db = supabaseAdmin()

  const { data: history } = await db
    .from('membership_imports')
    .select('season, imported_at, imported_by_label, rows_in_file, members_new, members_updated, members_missing')
    .order('imported_at', { ascending: false })
    .limit(10)

  const runs = (history ?? []) as Array<{
    season: string
    imported_at: string
    imported_by_label: string | null
    rows_in_file: number
    members_new: number
    members_updated: number
    members_missing: number
  }>

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm">
        <Link href="/admin" className="text-neutral-600 underline">
          &larr; Admin
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">Membership import</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Membership lives in AdminSkiRacing. This brings it across, so that whether
        somebody is a member is a lookup rather than something kept by hand.
      </p>

      {/* Said before the upload, not after: it explains why the season field is
          prefilled the way it is, and why a first import of a new year is expected
          to show everybody joining. */}
      {/* Three cases, not two. `isFallback` is false both when the current season
          has been imported AND when nothing has ever been imported, so branching on
          it alone claimed memberships existed on a database with none in it. */}
      <p className="mt-4 rounded-md border border-neutral-200 bg-surface px-3 py-2 text-sm dark:border-neutral-800">
        We are in <strong>{freshness.currentSeason}</strong>.{' '}
        {freshness.isFallback ? (
          <>
            Nothing has been imported for it yet, so the directory is still showing{' '}
            <strong>{display.season}</strong>. Membership renews annually — everyone
            starts each year as not renewed, and the first import of the season is
            what brings the renewals across.
          </>
        ) : freshness.lastImportedAt ? (
          <>
            Memberships for it have been imported
            {freshness.daysOld !== null &&
              ` — ${freshness.daysOld === 0 ? 'today' : `${freshness.daysOld} days ago`}`}
            . Import again to pick up anyone who has joined since.
          </>
        ) : (
          <>
            Nothing has been imported yet, so nobody counts as a current member and
            the directory shows Active as zero. Importing the export below is what
            fills it in.
          </>
        )}
      </p>

      <ImportForm suggestedSeason={freshness.currentSeason} />

      <h2 className="mt-10 text-sm font-medium text-neutral-600">Previous imports</h2>
      {runs.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-600">Nothing imported yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          {runs.map((r, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span>
                <strong>{r.season}</strong>
                <span className="text-neutral-600">
                  {' '}· {new Date(r.imported_at).toLocaleString()} ·{' '}
                  {r.imported_by_label ?? 'unknown'}
                </span>
              </span>
              <span className="text-neutral-600">
                {r.rows_in_file} rows · {r.members_new} added
                {r.members_updated > 0 && ` · ${r.members_updated} updated`}
                {r.members_missing > 0 && ` · ${r.members_missing} absent`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

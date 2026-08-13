/**
 * Admin index.
 *
 * A directory rather than a dashboard. Its job is to make sure nothing that has
 * been built is reachable only by someone who happens to know the URL — which is
 * how the recipient groups screen sat unused for a week.
 *
 * Unbuilt areas are listed too, marked as such. An honest gap is more useful than
 * a page that quietly omits half the system, particularly for whoever inherits
 * this and is trying to work out what exists.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'

/** Built and usable. */
const AVAILABLE = [
  {
    href: '/members',
    title: 'Members',
    description:
      'Look anyone up by name, phone or email. Shows whether they can be texted and why, which groups they are in, and everything the club has sent them.',
  },
  {
    href: '/admin/groups',
    title: 'Recipient groups',
    description:
      'Named audiences for the compose screen — test groups, officials, board members. Groups appear in the “Send to” list as soon as they have members.',
  },
]

/** Not built yet. Listed so the shape of the system is visible. */
const PLANNED = [
  { title: 'Season setup', description: 'Scoring rules: best-N, points scale, age groups.' },
  { title: 'Race schedule', description: 'Races, venues, live-timing ids, and which races count.' },
  {
    title: 'Officer accounts',
    description:
      'Invitations and roles. For now these are SQL scripts in supabase/ — see RUNBOOK.md.',
  },
]

export default async function AdminPage() {
  // Throws for a signed-in user who is not an admin. The proxy only checks that
  // someone is signed in; role is enforced here, next to the data.
  const appUser = await requireAppUser('admin')

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-neutral-500">Signed in as {appUser.email}</p>

      <ul className="mt-8 space-y-3">
        {AVAILABLE.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
            >
              <span className="font-medium">{item.title}</span>
              <span className="mt-1 block text-sm text-neutral-500">
                {item.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-sm font-medium text-neutral-500">Not built yet</h2>
      <ul className="mt-3 space-y-3">
        {PLANNED.map((item) => (
          <li
            key={item.title}
            className="rounded-lg border border-dashed border-neutral-300 p-4 dark:border-neutral-700"
          >
            <span className="font-medium text-neutral-500">{item.title}</span>
            <span className="mt-1 block text-sm text-neutral-500">
              {item.description}
            </span>
          </li>
        ))}
      </ul>
    </main>
  )
}

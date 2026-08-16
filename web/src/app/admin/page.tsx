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
import { supabaseAdmin } from '@/lib/supabase/admin'
import { countPending } from '@/lib/opt-in-review'

/** Built and usable. */
const AVAILABLE = [
  {
    href: '/members',
    title: 'Members',
    description:
      'Look anyone up by name, phone or email. Shows whether they can be texted and why, which groups they are in, and everything the club has sent them.',
  },
  {
    href: '/admin/opt-ins',
    title: 'Opt-in submissions',
    description:
      'People who filled in the form and could not be matched to a member automatically. They have consented and are waiting to be introduced.',
  },
  {
    href: '/admin/groups',
    title: 'Messaging groups',
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
  // Any signed-in officer, then the role is checked below. Asking for 'admin' here
  // would throw, and an unhandled error is a poor way to tell a colleague they need
  // to ask somebody — particularly now the nav badge invites them to click.
  const appUser = await requireAppUser()

  if (appUser.role !== 'admin') {
    // The opt-in queue itself only needs a signed-in officer, so a processor who
    // followed the badge can still do the work it was pointing at. Say that, and
    // name who can grant more — "access denied" leaves somebody with nothing to do
    // next but guess.
    const { data: admins } = await supabaseAdmin()
      .from('app_users')
      .select('user_id, people(first_name, last_name)')
      .eq('role', 'admin')

    // PostgREST returns a joined row as an array, so normalise to one record —
    // the same shape handling as in lib/audiences.ts.
    type Joined = { people: { first_name: string; last_name: string } | Array<{ first_name: string; last_name: string }> | null }

    const names = ((admins ?? []) as unknown as Joined[])
      .map(({ people }) => (Array.isArray(people) ? people[0] : people))
      .filter(Boolean)
      .map((p) => `${p!.first_name} ${p!.last_name}`)

    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-3 text-sm text-neutral-600">
          These settings are limited to admins, and your account is a processor.
          {names.length > 0
            ? ` Ask ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`} if you need access.`
            : ' Ask whoever set up your account if you need access.'}
        </p>

        <p className="mt-6 text-sm">
          <Link href="/admin/opt-ins" className="text-fwm-navy underline">
            Opt-in submissions
          </Link>{' '}
          <span className="text-neutral-600">
            is open to every officer, so you can still review those.
          </span>
        </p>
      </main>
    )
  }

  // The count is the whole point of surfacing this here: a review queue nobody is
  // told about is the same as no review queue, and the people in it have already
  // consented and are waiting to hear from the club.
  const pendingOptIns = await countPending()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-neutral-600">Signed in as {appUser.email}</p>

      <ul className="mt-8 space-y-3">
        {AVAILABLE.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block rounded-lg border border-neutral-200 bg-surface p-4 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{item.title}</span>
                {item.href === '/admin/opt-ins' && pendingOptIns > 0 && (
                  <span className="shrink-0 rounded-full bg-fwm-navy/10 px-2 py-0.5 text-sm font-medium text-fwm-navy">
                    {pendingOptIns} waiting
                  </span>
                )}
              </span>
              <span className="mt-1 block text-sm text-neutral-600">
                {item.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-10 text-sm font-medium text-neutral-600">Not built yet</h2>
      <ul className="mt-3 space-y-3">
        {PLANNED.map((item) => (
          <li
            key={item.title}
            className="rounded-lg border border-dashed border-neutral-300 p-4 dark:border-neutral-700"
          >
            <span className="font-medium text-neutral-600">{item.title}</span>
            <span className="mt-1 block text-sm text-neutral-600">
              {item.description}
            </span>
          </li>
        ))}
      </ul>
    </main>
  )
}

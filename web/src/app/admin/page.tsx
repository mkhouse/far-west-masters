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
import { countWaiting } from '@/lib/waiting'

/**
 * What is on this page, grouped.
 *
 * A flat list of seven reached the point where finding anything meant reading all
 * of it. The groups are by subject — members, messaging, racing, accounts — because
 * that is how somebody arrives: they want to do a thing to a member, or to a
 * message, and the question is which screen that lives on.
 *
 * `built: false` items are listed inside their own group rather than in a separate
 * pile at the bottom. The point of naming them at all is to show the real shape of
 * each area, and an area is easier to understand when its gaps sit next to what
 * exists.
 */
interface Item {
  title: string
  description: string
  /** Absent on anything not built yet. */
  href?: string
  /** A short state label, shown to the right of the title. */
  chip?: string
}

interface Group {
  title: string
  items: Item[]
}

/**
 * DESCRIPTIONS ARE ONE LINE EACH, deliberately.
 *
 * They used to be two or three sentences carrying the reasoning behind each screen
 * — why membership is a lookup, why season setup refuses to guess. That reasoning
 * is worth keeping, but not worth re-reading on every visit: after the first time,
 * it is a wall between an officer and the link they came for. It now lives in the
 * comments of the screens themselves and in RUNBOOK.md, where somebody who actually
 * wants it will be.
 *
 * What stays is enough to tell two neighbouring cards apart. That is the whole job
 * of this text, and it fits in a line.
 */
const GROUPS: Group[] = [
  {
    title: 'Members',
    items: [
      {
        href: '/members',
        title: 'Members',
        description:
          'Look anyone up, and see everything the club has sent them.',
      },
      {
        href: '/admin/membership',
        title: 'Membership import',
        description:
          'Bring the season\u2019s membership across from AdminSkiRacing.',
      },
    ],
  },
  {
    title: 'Messaging',
    items: [
      {
        href: '/admin/templates',
        title: 'Message templates',
        description: 'Wording the club reuses, with the blanks filled in on send.',
      },
      {
        href: '/admin/groups',
        title: 'Messaging groups',
        description: 'Named audiences for the compose screen.',
      },
    ],
  },
  {
    title: 'Racing',
    items: [
      {
        href: '/admin/schedule',
        title: 'Race schedule',
        description:
          'Import the season\u2019s races. Nothing is written until you apply.',
      },
      {
        href: '/admin/entries',
        title: 'Race entries',
        description: 'Who entered, so a text can go to just them.',
      },
      {
        href: '/admin/season',
        title: 'Season setup',
        description: 'Scoring rules. Nothing scores until they are set.',
      },
      {
        title: 'Live-timing ids',
        description: 'Entered per race once the links arrive.',
      },
    ],
  },
  {
    title: 'Accounts',
    items: [
      {
        href: '/account',
        title: 'Your account',
        description: 'The contact number templates hand to members.',
      },
      {
        title: 'Officer accounts',
        description: 'Invitations and roles \u2014 SQL scripts for now.',
      },
    ],
  },
]

/** Lifted out of the groups: the only entry that is a task rather than a place. */
const NEEDS_ACTION: Item = {
  href: '/admin/opt-ins',
  title: 'Opt-ins needing action',
  description:
    'Consented and waiting on the club \u2014 a submission to decide, an intro text to send, or a number that needs a phone call instead.',
}

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
            Opt-ins needing action
          </Link>{' '}
          <span className="text-neutral-600">
            is open to every officer, so you can still work through those.
          </span>
        </p>
      </main>
    )
  }

  // The count is the whole point of surfacing this here: a queue nobody is told
  // about is the same as no queue, and the people in it have already consented and
  // are waiting to hear from the club.
  //
  // Counts everyone waiting, matching the nav badge. Reading from countPending()
  // here while the nav read something broader would put two different numbers for
  // the same thing on screen at once.
  const waitingCount = await countWaiting()

  const groups =
    waitingCount > 0
      ? GROUPS
      : GROUPS.map((g) =>
          g.title === 'Members'
            ? {
                ...g,
                items: [
                  ...g.items,
                  {
                    ...NEEDS_ACTION,
                    // STATE THE STATE. Hiding the banner is only a signal to
                    // somebody who has seen the banner — a reader who has never had
                    // anything waiting cannot read its absence, and is left unsure
                    // whether this screen has work on it or they simply cannot see
                    // it. So the quiet card says so outright, in the chip and in the
                    // first words of the description, rather than relying on what is
                    // missing elsewhere.
                    chip: 'Nothing waiting',
                    description:
                      'Nothing needs action right now. Submissions, intro texts and rejected numbers appear here.',
                  },
                ],
              }
            : g
        )

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Signed in as {appUser.name ? `${appUser.name} · ` : ''}
        {appUser.email}
      </p>

      {/* --- anything waiting, first and on its own ---
          Only rendered when somebody is actually waiting. A permanent entry here
          would be one more thing to scan past; an entry that appears only when it
          means something is one you read. */}
      {waitingCount > 0 && (
        <Link
          href={NEEDS_ACTION.href!}
          className="mt-8 block rounded-lg border border-fwm-navy/30 bg-fwm-navy/5 p-4 hover:border-fwm-navy/60"
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-fwm-navy">{NEEDS_ACTION.title}</span>
            <span className="shrink-0 rounded-full bg-fwm-navy px-2 py-0.5 text-sm font-medium text-white">
              {waitingCount} waiting
            </span>
          </span>
          <span className="mt-1 block text-sm text-neutral-600">
            {NEEDS_ACTION.description}
          </span>
        </Link>
      )}


      {/* When nobody is waiting there is no banner at all — an always-present
          "nothing to do here" line is one more thing to read past every visit.
          The entry is not hidden, though: it joins the Members group as an ordinary
          card, because this page exists so that nothing built is reachable only by
          somebody who happens to know the URL. Quiet, not gone. */}
      {groups.map((group) => (
        <section key={group.title} className="mt-8">
          <h2 className="text-sm font-medium tracking-wide text-neutral-600 uppercase">
            {group.title}
          </h2>

          {/* TWO UP FROM 640px, one on a phone. A single column of nine tall
              cards ran well past a phone screen, so the shape of the whole system
              — which is what this page is for — could not be seen at once. */}
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {group.items.map((item) =>
              item.href ? (
                <li key={item.title}>
                  <Link
                    href={item.href}
                    className="block h-full rounded-lg border border-neutral-200 bg-surface p-3 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{item.title}</span>
                      {/* Sits where the navy count sits on the banner, so the two
                          states read as the same control in two conditions rather
                          than as two unrelated things. */}
                      {item.chip && (
                        <span className="shrink-0 rounded-full bg-fwm-teal/15 px-2 py-0.5 text-sm font-medium text-fwm-teal-text">
                          {item.chip}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 hidden text-sm text-neutral-600 sm:block">
                      {item.description}
                    </span>
                  </Link>
                </li>
              ) : (
                // Dashed and muted, in place rather than in a pile at the bottom:
                // the gap belongs beside the thing it is a gap in.
                <li
                  key={item.title}
                  className="h-full rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-neutral-600">{item.title}</span>
                    <span className="shrink-0 text-sm text-neutral-500">
                      not built yet
                    </span>
                  </span>
                  <span className="mt-1 hidden text-sm text-neutral-600 sm:block">
                    {item.description}
                  </span>
                </li>
              )
            )}
          </ul>
        </section>
      ))}

    </main>
  )
}

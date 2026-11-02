/**
 * The bar across the top of every signed-in page.
 *
 * Renders nothing at all when there is no session, so the sign-in screen and the
 * public pages stay clean. That is why this is a server component: it needs to know
 * who is signed in before deciding whether it exists.
 *
 * Its job is small but not cosmetic. An officer at a race, on a shared laptop,
 * needs to see which account they are using and be able to leave it. "Clear your
 * cookies" is not an instruction anyone should have to follow.
 */

import { getUser } from '@/lib/supabase/server'
import { countWaiting } from '@/lib/waiting'
import { NavLinks } from './nav-links'

export async function AppHeader() {
  const user = await getUser()
  if (!user) return null

  // EVERYONE waiting, not just the review queue.
  //
  // This counted pending submissions alone until 2 November 2026, and the gap was
  // not academic: on that day there were zero pending submissions and three people
  // who had opted in and never been sent an intro — one of them since March 2025.
  // The badge read nothing at all while three members waited, because the only
  // thing that would have shown them was a filter somebody had to think to apply.
  //
  // A few extra queries on every signed-in page, and the price of a queue being
  // noticed at all rather than only by whoever remembers to look.
  const waitingCount = await countWaiting()

  return (
    // White, not the page grey: the bar needs to read as a fixed frame around the
    // content rather than as part of it.
    <header className="border-b border-neutral-200 bg-surface dark:border-neutral-800">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <NavLinks badges={{ '/admin': waitingCount }} />

        <div className="flex items-center gap-3 text-sm">
          {/* Which account, not just that you are signed in. On a shared machine
              those are different questions, and sending a text as the wrong
              officer is not something you can take back. */}
          <span className="hidden text-neutral-600 sm:inline">{user.email}</span>

          {/* A form, not a link: sign-out is a POST so that nothing else can
              trigger it on the officer's behalf. See app/sign-out/route.ts */}
          <form action="/sign-out" method="post">
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}

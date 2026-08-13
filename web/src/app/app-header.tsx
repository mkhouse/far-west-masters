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

import Link from 'next/link'
import { getUser } from '@/lib/supabase/server'

export async function AppHeader() {
  const user = await getUser()
  if (!user) return null

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/messages" className="font-medium hover:underline">
            Messages
          </Link>
          <Link href="/members" className="text-neutral-500 hover:underline">
            Members
          </Link>
          <Link href="/admin" className="text-neutral-500 hover:underline">
            Admin
          </Link>
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {/* Which account, not just that you are signed in. On a shared machine
              those are different questions, and sending a text as the wrong
              officer is not something you can take back. */}
          <span className="hidden text-neutral-500 sm:inline">{user.email}</span>

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

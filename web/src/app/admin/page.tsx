/**
 * Admin area (task #6): season setup, race schedule, officer accounts.
 * Placeholder — the route exists so the protected boundary is testable.
 */
import { requireAppUser } from '@/lib/auth'

export default async function AdminPage() {
  // Throws for a signed-in user who is not an admin. Middleware only checks that
  // someone is signed in; role is enforced here, next to the data.
  const appUser = await requireAppUser('admin')

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-neutral-500">Signed in as {appUser.email}</p>
      <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
        Season setup, race schedule and officer accounts will live here.
      </p>
    </main>
  )
}

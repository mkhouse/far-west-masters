/**
 * Results processing (task #6): import preliminary and official results.
 * Placeholder — the route exists so the protected boundary is testable.
 */
import { requireAppUser } from '@/lib/auth'

export default async function ProcessPage() {
  const appUser = await requireAppUser()

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">Process results</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Signed in as {appUser.email} ({appUser.role})
      </p>
      <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
        Import from live-timing, review the preliminary-to-official diff, publish.
      </p>
    </main>
  )
}

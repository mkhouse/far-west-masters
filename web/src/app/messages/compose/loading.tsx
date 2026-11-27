/**
 * Shown the instant the compose screen is asked for.
 *
 * THE TAP HAS TO DO SOMETHING. This route is dynamic — it resolves the audience
 * against live data before it can render — so until it finishes, Next keeps the
 * previous page on screen. From the race-day block that meant pressing "Text 28
 * of the 45 racing this weekend" and watching the messages page sit there, which
 * reads as a dead button: Melissa, 2026-11-27, "I'm clicking it a couple of
 * times before the quick compose appears."
 *
 * The queries behind it were also sequential, and are not any more — 1,659 ms of
 * round trips down to about 420 — but no amount of fast is instant, and a button
 * that does nothing visible is broken regardless of how long nothing lasts.
 *
 * Deliberately the shape of the real screen rather than a spinner: the same card
 * and the same three bands, so the layout does not jump when the content lands.
 */

export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12" aria-busy="true">
      <h1 className="text-xl font-semibold">Compose message</h1>
      <p className="mt-1 text-sm text-neutral-600" role="status">
        Working out who this reaches&hellip;
      </p>

      <div className="mt-6 animate-pulse overflow-hidden rounded-lg border border-neutral-200 bg-surface dark:border-neutral-800">
        <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="h-4 w-24 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="mt-3 h-10 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>
        <div className="px-5 py-4">
          <div className="h-4 w-20 rounded bg-neutral-200 dark:bg-neutral-800" />
          <div className="mt-3 h-32 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
        </div>
      </div>

      <div className="mt-6 h-10 w-40 animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-800" />
    </main>
  )
}

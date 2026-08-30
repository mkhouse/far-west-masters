import 'server-only'

/**
 * Where the published schedule comes from.
 *
 * Three sources, in the order the import screen offers them:
 *
 *   1. **The repository.** archive/<season>/schedule/*.html, which is where the club
 *      keeps it. Editing it is a commit, so the repository is the record of what the
 *      schedule said and when it said it.
 *   2. **farwestmasters.org.** The same content, for when the archived copy has not
 *      been updated yet.
 *   3. **Pasted HTML.** The fallback that always works — the site being down, or a
 *      season whose file was never archived, should not stop an import.
 *
 * The filename differs between seasons ('race-schedule-2026-27.html',
 * 'schedule-table-final-2025-26.html'), so the season's folder is searched rather
 * than a name being constructed. A convention that has already varied twice will vary
 * again.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export type SourceKind = 'archive' | 'live' | 'pasted'

export interface ScheduleSource {
  kind: SourceKind
  html: string
  /** Where it came from, for the screen to show. */
  description: string
}

export const SCHEDULE_URL = 'https://farwestmasters.org/schedule'

/**
 * The archive directory, resolved from the running app rather than the process
 * working directory — which differs between `next dev`, `next build` and a
 * serverless invocation.
 */
function archiveRoot(): string {
  return join(process.cwd(), '..', 'archive')
}

/** Season folders that exist, newest first. */
export async function archivedSeasons(): Promise<string[]> {
  try {
    const entries = await readdir(archiveRoot(), { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{4}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
  } catch {
    // Not deployed, or not a checkout. The other two sources still work, and the
    // screen says so rather than presenting an empty list as though nothing exists.
    return []
  }
}

/**
 * Read the schedule for a season out of the repository.
 *
 * @returns null when there is no archived copy — a missing file is an ordinary
 *          situation (a season not yet archived), not an error worth throwing over.
 */
export async function fromArchive(season: string): Promise<ScheduleSource | null> {
  // Guard the path: `season` reaches here from a query parameter, and '../..' in it
  // would otherwise read files elsewhere on the machine.
  if (!/^\d{4}-\d{4}$/.test(season)) return null

  const dir = join(archiveRoot(), season, 'schedule')

  try {
    const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.html'))
    if (!files.length) return null

    // More than one is unexpected but harmless; take the last by name, which for
    // these files sorts to the most recent.
    const name = files.sort()[files.length - 1]
    const html = await readFile(join(dir, name), 'utf8')

    return {
      kind: 'archive',
      html,
      description: `archive/${season}/schedule/${name}`,
    }
  } catch {
    return null
  }
}

/**
 * Fetch the published page.
 *
 * Never cached: an officer pressing "fetch the live page" wants what is on it now,
 * and a stale copy would be worse than useless — it is the thing they came here to
 * check against.
 */
export async function fromLive(): Promise<ScheduleSource> {
  const response = await fetch(SCHEDULE_URL, {
    cache: 'no-store',
    headers: { 'User-Agent': 'far-west-masters-app (schedule import)' },
  })

  if (!response.ok) {
    throw new Error(
      `farwestmasters.org returned ${response.status}. Use the archived copy, or ` +
        `paste the page source.`
    )
  }

  return {
    kind: 'live',
    html: await response.text(),
    description: SCHEDULE_URL,
  }
}

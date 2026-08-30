'use server'

/**
 * Resolve an audience without leaving the page.
 *
 * The compose screen used to change audience by setting `window.location.search`,
 * which reloaded the page and discarded whatever had been typed. That was a fair
 * trade when picking an audience was the first thing you did; it stopped being one
 * when choosing a single recipient became a normal step, because the obvious order —
 * write the message, then realise you picked the wrong person — loses the message.
 *
 * The reason the audience lived in the URL still holds: the recipient count and the
 * exclusion reasons must be computed on the server against live data, never estimated
 * in the browser. A count the browser guessed at is exactly the number nobody should
 * trust immediately before pressing Send.
 *
 * A server action keeps that property and drops the navigation. The resolution still
 * happens here, on the server, against the database; only the page load goes away.
 *
 * This grants no new power. It reads counts and exclusion reasons — the same thing
 * the page already renders — and sends nothing. `sendMessage` re-resolves the
 * audience from scratch regardless of anything this returned, so a manipulated call
 * here still cannot decide who receives a text.
 */

import { requireAppUser } from '@/lib/auth'
import { resolveAudience, type AudienceKind, type AudienceResult } from '@/lib/audiences'
import { filterFromParams } from '@/lib/member-filters'

export async function resolveAudienceAction(input: {
  kind: AudienceKind
  groupId?: string
  personIds?: string[]
  series?: string
  filterParams?: Record<string, string>
}): Promise<AudienceResult> {
  // Still behind the same authorisation as the page. An unauthenticated caller
  // learns nothing about who is in the club.
  await requireAppUser()

  return resolveAudience(input.kind, {
    groupId: input.groupId || undefined,
    personIds: input.personIds?.filter(Boolean),
    series: input.series || undefined,
    filter:
      input.kind === 'filtered' && input.filterParams
        ? filterFromParams(input.filterParams)
        : undefined,
  })
}

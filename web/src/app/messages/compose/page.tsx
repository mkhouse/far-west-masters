/**
 * Compose a message.
 *
 * Loads everything the composer needs from the database rather than hardcoding it:
 * the officers who can receive replies, the length thresholds, and the current
 * eligible audience. All of those are policy an admin can change without a deploy.
 */

import { getAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { listAudiences, resolveAudience, type AudienceKind } from '@/lib/audiences'
import { ComposeForm, type ComposeSettings, type Officer } from './compose-form'

/** Read the operational settings, falling back to documented defaults. */
async function loadSettings(): Promise<ComposeSettings> {
  const { data } = await supabaseAdmin().from('app_settings').select('key, value')
  const get = (key: string, fallback: string) =>
    data?.find((r) => r.key === key)?.value ?? fallback

  return {
    warnSegments: parseInt(get('sms_warn_segments', '2'), 10),
    maxSegments: parseInt(get('sms_max_segments', '3'), 10),
    maxEmoji: parseInt(get('sms_max_emoji', '3'), 10),
    // The opt-out line itself, not its length — the composer derives the cost from
    // the text so the two cannot fall out of step. See migration 0018.
    optOutText: get('sms_optout_text', 'Text STOP to stop'),
    defaultReplyNotice: get('sms_default_reply_notice', 'Replies not monitored.'),
    costPerSegmentUsd: parseFloat(get('sms_cost_per_segment_usd', '0.0109')),
  }
}

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string; series?: string; group?: string }>
}) {
  const params = await searchParams
  const appUser = await getAppUser()
  if (!appUser) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          You are signed in, but this account has not been granted access.
        </p>
      </main>
    )
  }

  const db = supabaseAdmin()

  // Officers with a phone number populate the reply-to picker. Sourced from the
  // member records rather than a separate contacts list, so there is nothing extra
  // to keep in step.
  const { data: officerRows } = await db
    .from('people')
    .select('id, first_name, last_name, phone')
    .eq('status', 'officer')
    .not('phone', 'is', null)
    .order('last_name')

  const officers: Officer[] = (officerRows ?? []).map((o) => ({
    id: o.id as string,
    name: `${o.first_name} ${o.last_name}`,
    phone: o.phone as string,
  }))

  const { data: defaultRows } = await db
    .from('category_reply_defaults')
    .select('category, person_id')

  const categoryDefaults = Object.fromEntries(
    (defaultRows ?? []).map((d) => [d.category as string, d.person_id as string])
  )

  // The audience determines the recipient count, which in turn drives the cost
  // estimate. Default to the test group: the safe choice if someone opens this
  // screen and starts typing without thinking about who it reaches.
  const audiences = await listAudiences()

  // Default to the first audience, which listAudiences puts a test group at — the
  // safe landing place if someone opens this screen and starts typing.
  const fallback = audiences[0]
  const selectedKind = (params.audience as AudienceKind) ?? fallback?.kind ?? 'all_eligible'
  const audience = await resolveAudience(selectedKind, {
    series: params.series,
    groupId: params.group ?? (params.audience ? undefined : fallback?.groupId),
  })

  const settings = await loadSettings()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-xl font-semibold">Compose message</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Signed in as {appUser.email} ({appUser.role})
      </p>

      <div className="mt-8">
        <ComposeForm
          officers={officers}
          settings={settings}
          categoryDefaults={categoryDefaults}
          audiences={audiences}
          audience={audience}
          selectedSeries={params.series}
          selectedGroupId={params.group ?? fallback?.groupId}
        />
      </div>

      {/* Corrected: the app appends the opt-out line, not Twilio. See migration
          0018 — believing otherwise is what left it off real messages for a day. */}
      <p className="mt-8 text-sm text-neutral-600">
        &ldquo;Text STOP to stop&rdquo; is added to every message and is already
        counted above. Cost is approximate — it excludes the monthly number and
        registration fees, and rates vary by carrier.
      </p>
    </main>
  )
}

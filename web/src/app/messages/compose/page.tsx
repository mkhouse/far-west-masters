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
import { filterFromParams, filterToParams } from '@/lib/member-filters'
import { membershipContext } from '@/lib/membership'
import { raceLabel, upcomingRaces } from '@/lib/races'
import { CONSENT_STATE_LABEL, consentState } from '@/lib/members'
import type { MessageTemplate } from '@/lib/templates'
import { MembershipBanner } from '../../membership-banner'
import { ComposeForm, type ComposeSettings, type Officer } from './compose-form'
import type { PersonOption } from './person-picker'
import type { RaceOption } from './template-picker'

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
    // Filled into the message box when the intro audience is chosen — see
    // migration 0023. Stored so the wording stops drifting between sends.
    introText: get('sms_intro_text', ''),
    costPerSegmentUsd: parseFloat(get('sms_cost_per_segment_usd', '0.0109')),
  }
}

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<{
    audience?: string
    series?: string
    group?: string
    person?: string
    // Carried through from the members directory when messaging a filtered set.
    membership?: string
    filter?: string
    missing?: string
    q?: string
  }>
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

  // --- everyone who can be picked as a single recipient ---
  //
  // The whole list, not only people who can be texted, each carrying the reason if
  // they cannot. Omitting them would make "why is Bob not in this list?" unanswerable
  // from this screen; the consent gate still applies on the server, so listing
  // somebody here cannot send them anything.
  const { data: peopleRows } = await db
    .from('people')
    .select(
      'id, first_name, last_name, phone, opt_in_at, intro_sent_at, opted_out_at, sms_never'
    )
    .order('last_name')

  interface PersonRow {
    id: string
    first_name: string
    last_name: string
    phone: string | null
    opt_in_at: string | null
    intro_sent_at: string | null
    opted_out_at: string | null
    sms_never: boolean
  }

  const people: PersonOption[] = ((peopleRows ?? []) as unknown as PersonRow[]).map(
    (p) => {
      const state = consentState(p)
      return {
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        // Same vocabulary as the members directory and the audience labels — one set
        // of words for member state everywhere.
        blockedReason: state === 'eligible' ? null : CONSENT_STATE_LABEL[state],
      }
    }
  )

  // --- what the template picker needs ---
  //
  // Live templates only. An archived one is kept for the record, not for sending.
  const { data: templateRows } = await db
    .from('message_templates')
    .select('id, name, category, body')
    .is('archived_at', null)
    .order('category')
    .order('name')

  const templates = (templateRows ?? []) as unknown as MessageTemplate[]

  const races: RaceOption[] = (await upcomingRaces()).map((r) => ({
    id: r.id,
    venue: r.venue,
    label: raceLabel(r),
  }))

  // The officer's own details, for {officer name} and {officer phone}.
  //
  // The phone comes from `app_users`, NOT from their member record — see migration
  // 0030. `people.phone` is where the club texts them and where member replies are
  // forwarded; it has never been shown to a member, and quietly reusing it here would
  // publish it to everyone this template is ever sent to.
  const { data: meRow } = await db
    .from('app_users')
    .select('contact_phone')
    .eq('user_id', appUser.userId)
    .maybeSingle()

  const officerPhone = (meRow?.contact_phone as string | null) ?? null

  let officerFirstName: string | null = null
  if (appUser.personId) {
    const { data: me } = await db
      .from('people')
      .select('first_name')
      .eq('id', appUser.personId)
      .maybeSingle()
    officerFirstName = (me?.first_name as string | null) ?? null
  }

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

  // NOTHING IS SELECTED BY DEFAULT.
  //
  // This used to land on the first audience, which listAudiences puts a test group
  // at, on the reasoning that a test group is the safe thing to default to. It is
  // safe, and it is still a default — the screen arrives with a recipient already
  // chosen, and a default that is usually right is exactly the kind a person stops
  // reading. Requiring a choice costs one click and removes the case where somebody
  // composes carefully and sends to whoever happened to be preselected.
  const selectedKind = params.audience as AudienceKind | undefined

  // A filtered audience is not in the picker — it exists only for the send you
  // arrived with, described by the filters that produced it.
  const filter = selectedKind === 'filtered' ? filterFromParams(params) : undefined

  const audience = selectedKind
    ? await resolveAudience(selectedKind, {
        series: params.series,
        groupId: params.group,
        personId: params.person,
        filter,
      })
    : {
        kind: '' as AudienceKind,
        label: '',
        recipientCount: 0,
        consideredCount: 0,
        excluded: [],
        incompleteConsent: false,
        unavailableReason: 'Choose who this message goes to.',
      }

  const settings = await loadSettings()

  // A stale membership list means an audience missing anyone who joined recently.
  const { freshness } = await membershipContext()

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <MembershipBanner freshness={freshness} />
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
          templates={templates}
          races={races}
          people={people}
          selectedPersonId={params.person}
          officerName={officerFirstName}
          officerPhone={officerPhone}
          // Prefilled, not auto-sent. The officer still reads it and presses Send:
          // a stored template is exactly what drifts out of date unnoticed.
          prefillBody={audience.kind === 'intro_pending' ? settings.introText : ''}
          prefillPurpose={audience.kind === 'intro_pending' ? 'Intro text' : ''}
          selectedSeries={params.series}
          selectedGroupId={params.group}
          filterParams={filter ? filterToParams(filter) : undefined}
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

'use server'

/**
 * Send a message.
 *
 * This is the only irreversible action in the system, so it is deliberately
 * defensive. The order matters:
 *
 *   1. authorise the sender
 *   2. re-resolve the audience on the server
 *   3. re-check length and emoji limits on the server
 *   4. record the message BEFORE sending anything
 *   5. send, recording each result as it happens
 *
 * Step 2 is the important one. The recipient list is never taken from the browser:
 * a stale page, a manipulated form, or a race with an import running would
 * otherwise decide who gets a text.
 */

import { redirect } from 'next/navigation'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveAudience, type AudienceKind } from '@/lib/audiences'
import {
  FILTER_COLUMNS,
  applyFilter,
  filterFromParams,
  filterToParams,
  type FilterablePerson,
  type MemberFilter,
} from '@/lib/member-filters'
import { additionsLength, checkSendability, composeBody } from '@/lib/sms/segments'
import { describePlaceholders, findPlaceholders } from '@/lib/templates'
import { sendMany, twilioConfig } from '@/lib/sms/twilio'

/** Consent-relevant columns, matching the audience module. */
const GATE = 'id, phone, opted_out_at, sms_never, opt_in_at, intro_sent_at'

interface GatePerson {
  id: string
  phone: string | null
  opted_out_at: string | null
  sms_never: boolean
  opt_in_at: string | null
  intro_sent_at: string | null
}

/**
 * The actual recipients for an audience.
 *
 * Mirrors resolveAudience, which returns counts; this returns the people. They read
 * from the same columns and apply the same rules, and both must stay in step — if
 * they ever disagree, the count shown before sending would not match who received
 * the message.
 */
async function recipientsFor(
  kind: AudienceKind,
  opts: { series?: string; groupId?: string; personId?: string; filter?: MemberFilter }
): Promise<{ people: GatePerson[]; incompleteConsent: boolean }> {
  const db = supabaseAdmin()

  const passesGate = (p: GatePerson) =>
    !!p.phone && !p.opted_out_at && !p.sms_never && !!p.opt_in_at && !!p.intro_sent_at

  switch (kind) {
    case 'person': {
      // One member. Filtered by exactly the same predicate as every audience above
      // it — a one-to-one send is still a send from the club's number, and the fact
      // that an officer has chosen this person deliberately is not consent.
      if (!opts.personId) return { people: [], incompleteConsent: false }

      const { data } = await db
        .from('people')
        .select(GATE)
        .eq('id', opts.personId)
        .maybeSingle()

      const person = data as GatePerson | null
      return {
        people: person && passesGate(person) ? [person] : [],
        incompleteConsent: false,
      }
    }

    case 'group': {
      // Groups always apply the consent gate — see migration 0020. There is
      // deliberately no per-group escape hatch: an audience that can silently skip
      // consent gets set once for a good reason and then forgotten.
      if (!opts.groupId) return { people: [], incompleteConsent: false }
      const { data: rows } = await db
        .from('recipient_group_members')
        .select(`people!inner(${GATE})`)
        .eq('group_id', opts.groupId)

      const people = (rows ?? [])
        .map((r) => {
          const p = (r as { people: GatePerson | GatePerson[] }).people
          return Array.isArray(p) ? p[0] : p
        })
        .filter(Boolean) as GatePerson[]

      return { people: people.filter(passesGate), incompleteConsent: false }
    }

    case 'all_eligible': {
      const { data } = await db.from('people').select(GATE)
      return {
        people: ((data ?? []) as GatePerson[]).filter(passesGate),
        incompleteConsent: false,
      }
    }

    case 'always': {
      const { data } = await db.from('people').select(GATE).eq('sms_always', true)
      return {
        people: ((data ?? []) as GatePerson[]).filter(passesGate),
        incompleteConsent: false,
      }
    }

    case 'filtered': {
      // A slice of the members directory. The filter selects candidates; the
      // consent gate applies on top, unconditionally — so no filter combination
      // can reach anyone who has not opted in.
      if (!opts.filter) return { people: [], incompleteConsent: false }

      const { data } = await db.from('people').select(FILTER_COLUMNS)
      const candidates = applyFilter(
        (data ?? []) as unknown as FilterablePerson[],
        opts.filter
      )
      return {
        people: (candidates as unknown as GatePerson[]).filter(passesGate),
        incompleteConsent: false,
      }
    }

    case 'intro_pending': {
      // Opted in, not yet sent the intro text that completes their consent.
      //
      // Note what is still required: opt_in_at. This is not a bypass — nothing in
      // this system messages anyone who has not opted in. FWM's consent flow, as
      // described to Twilio when the toll-free number was verified, is form first
      // and then intro text, so an intro text always follows a form submission.
      const { data } = await db
        .from('people')
        .select(GATE)
        .not('opt_in_at', 'is', null)
        .is('intro_sent_at', null)

      const people = ((data ?? []) as GatePerson[]).filter(
        (p) => !!p.phone && !p.opted_out_at && !p.sms_never
      )
      return { people, incompleteConsent: true }
    }

    case 'series': {
      if (!opts.series) return { people: [], incompleteConsent: false }
      const { data: entries } = await db
        .from('race_entries')
        .select(`person_id, people!inner(${GATE}), races!inner(series)`)
        .eq('races.series', opts.series)

      const seen = new Map<string, GatePerson>()
      for (const e of (entries ?? []) as Array<{
        person_id: string | null
        people: GatePerson | GatePerson[]
      }>) {
        if (!e.person_id || seen.has(e.person_id)) continue
        const p = Array.isArray(e.people) ? e.people[0] : e.people
        if (p) seen.set(e.person_id, p)
      }
      const all = [...seen.values()]

      return { people: all.filter(passesGate), incompleteConsent: false }
    }
  }
}

export async function sendMessage(formData: FormData) {
  const appUser = await requireAppUser()
  const db = supabaseAdmin()

  const body = String(formData.get('body') ?? '').trim()
  const kind = String(formData.get('audience_kind') ?? '') as AudienceKind
  const groupId = String(formData.get('group_id') ?? '') || undefined
  const series = String(formData.get('series') ?? '') || undefined
  const personId = String(formData.get('person_id') ?? '') || undefined
  const category = String(formData.get('category') ?? 'general')
  const purpose = String(formData.get('purpose') ?? '').trim() || null
  const repliesMonitored = formData.get('replies_monitored') === 'on'
  const replyNotice = repliesMonitored
    ? null
    : String(formData.get('reply_notice') ?? '').trim() || null
  const replyPersonId = String(formData.get('reply_person_id') ?? '') || null

  // The filter that produced this audience, when the send came from the members
  // directory. Carried as parameters and re-resolved here rather than as a list of
  // people, so the browser still never decides who receives anything.
  const filter =
    kind === 'filtered'
      ? filterFromParams({
          membership: String(formData.get('f_membership') ?? ''),
          filter: String(formData.get('f_texting') ?? ''),
          missing: String(formData.get('f_missing') ?? ''),
          q: String(formData.get('f_q') ?? ''),
        })
      : undefined

  const fail = (msg: string) =>
    redirect(`/messages/compose?error=${encodeURIComponent(msg)}`)

  if (!body) fail('Nothing to send — the message is empty.')

  // --- no unfilled blanks ---
  //
  // The composer disables the button while a placeholder remains, but a disabled
  // button is a courtesy, not a control: this action is reachable directly, and a tab
  // left open while somebody edited the template would submit stale text. Checked
  // here because this is the last point before the words reach a phone.
  //
  // Deliberately checks for ANY placeholder rather than a known list. A template
  // containing {race director} is a mistake, and sending those literal characters to
  // three hundred members is exactly the mistake worth refusing.
  const blanks = findPlaceholders(body)
  if (blanks.length) {
    fail(
      `This message still has blanks in it. ` +
        `${describePlaceholders(blanks.map((b) => `{${b}}`))} ` +
        `Fill them in before sending — nothing was sent.`
    )
  }

  const tw = twilioConfig()
  if ('missing' in tw) {
    fail(`Sending is not configured yet. Missing: ${tw.missing.join(', ')}`)
    return
  }

  // Re-resolve on the server. Never trust a recipient list from the browser.
  const { people, incompleteConsent } = await recipientsFor(kind, {
    series,
    groupId,
    personId,
    filter,
  })
  if (!people.length) fail('That audience has nobody in it right now.')

  // Re-check the limits too. The client shows them, but the client can be stale.
  const settingsRows = await db.from('app_settings').select('key, value')
  const setting = (k: string, d: string) =>
    settingsRows.data?.find((r) => r.key === k)?.value ?? d

  // What the app adds after the sender stops typing. The cost is measured from the
  // assembled message rather than assumed, so the counter cannot disagree with what
  // actually goes out.
  const additions = {
    replyNotice,
    optOutText: setting('sms_optout_text', 'Text STOP to stop'),
  }

  const verdict = checkSendability(body, people.length, {
    appendedLength: additionsLength(body, additions),
    warnSegments: parseInt(setting('sms_warn_segments', '2'), 10),
    maxSegments: parseInt(setting('sms_max_segments', '3'), 10),
    maxEmoji: parseInt(setting('sms_max_emoji', '3'), 10),
  })
  if (verdict.blocked) fail(verdict.reason ?? 'This message cannot be sent.')

  // Where replies go, resolved to a number now and stored, so reassigning an
  // officer later cannot re-route this message's replies.
  let replyForwardTo: string | null = null
  if (replyPersonId) {
    const { data: person } = await db
      .from('people')
      .select('phone')
      .eq('id', replyPersonId)
      .single()
    replyForwardTo = (person?.phone as string) ?? null
  }

  // --- duplicate guard ---
  //
  // The button cannot be clicked twice, but a browser can still resubmit: a
  // refresh, a back-button, a flaky connection retried, or two officers acting on
  // the same request minutes apart. Any of those sends the whole audience a second
  // copy, and a text cannot be unsent.
  //
  // So: refuse an identical message to the same audience from the same officer
  // inside a short window. Deliberately narrow — a genuinely intended repeat is
  // rare, and waiting a few minutes is a far smaller cost than texting ninety
  // people twice.
  const DUPLICATE_WINDOW_MINUTES = 10
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString()

  // Matched on the specific audience, not just its kind — the same words sent to
  // two different groups is a normal thing to do, and must not be mistaken for a
  // double-click.
  let duplicateQuery = db
    .from('messages')
    .select('id, created_at')
    .eq('created_by', appUser.userId)
    .eq('body', body)
    .eq('audience_kind', kind)
    .gte('created_at', since)

  duplicateQuery = groupId
    ? duplicateQuery.eq('group_id', groupId)
    : duplicateQuery.is('group_id', null)

  duplicateQuery = series
    ? duplicateQuery.eq('series', series)
    : duplicateQuery.is('series', null)

  // The recipient, for a one-to-one send.
  //
  // Without this the guard breaks the workflow it is supposed to protect. Group and
  // series are both null for a person send, so an identical body would match ANY
  // recent one-to-one message — and working through five new members with the same
  // template is the ordinary use of this feature, not a double-click.
  //
  // It is not enough that the body usually differs. Two of the eight templates carry
  // no {first name} at all — the event waiver is the same words for everybody — so
  // those would collide every time.
  //
  // The person is read from `audience`, the jsonb column that already carries the
  // filter spec for a filtered send, rather than a new column.
  if (personId) duplicateQuery = duplicateQuery.eq('audience->>person_id', personId)

  const { data: recent } = await duplicateQuery.limit(1).maybeSingle()

  if (recent) {
    const id = (recent as { id: string }).id
    fail(
      `That exact message was already sent to this audience in the last ` +
        `${DUPLICATE_WINDOW_MINUTES} minutes. If you meant to send it again, wait ` +
        `a few minutes or change the wording. Open /messages/${id} to see what went out.`
    )
  }

  const audience = await resolveAudience(kind, { series, groupId, personId, filter })

  // Who is sending, in a form a person can read months from now. Stored on the
  // message rather than looked up later: `created_by` points into the auth schema,
  // which the app cannot read, and a name joined through `people` would vanish if
  // that member's details were ever scrubbed. See migration 0017.
  let sentBy = appUser.email
  if (appUser.personId) {
    const { data: me } = await db
      .from('people')
      .select('first_name, last_name')
      .eq('id', appUser.personId)
      .maybeSingle()
    const name = `${me?.first_name ?? ''} ${me?.last_name ?? ''}`.trim()
    if (name) sentBy = name
  }

  // Record the message before sending. If the process dies mid-send, the record
  // exists and the per-recipient rows show how far it got — far better than
  // messages having gone out with nothing to show for them.
  const { data: message, error: msgError } = await db
    .from('messages')
    .insert({
      body,
      category,
      purpose,
      audience_kind: kind,
      audience_label: audience.label,
      group_id: groupId ?? null,
      series: series ?? null,
      // The filter spec, so the log can say exactly which slice was messaged and
      // the same set could be rebuilt later. `audience` is the jsonb column that
      // has been unused since the initial schema; this is what it was for.
      // What defined this audience beyond its kind: the filter spec for a filtered
      // send, the recipient for a one-to-one one. Both make the log able to say
      // exactly who was messaged and why, months later.
      audience: filter
        ? filterToParams(filter)
        : personId
          ? { person_id: personId }
          : null,
      bypassed_consent_gate: incompleteConsent,
      replies_monitored: repliesMonitored,
      reply_notice: replyNotice,
      reply_forward_to: replyForwardTo,
      reply_forward_person_id: replyPersonId,
      status: 'sending',
      segments: verdict.info.segments,
      created_by: appUser.userId,
      sent_by: sentBy,
    })
    .select('id')
    .single()

  if (msgError || !message) fail(`Could not record the message: ${msgError?.message}`)

  const messageId = (message as { id: string }).id
  const text = composeBody(body, additions)

  // Ask Twilio to report delivery state back. Without this a send is only ever
  // known to have been "accepted", which is not the same as delivered — a
  // disconnected number would look like a success forever.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  const statusCallback = siteUrl?.startsWith('https://')
    ? `${siteUrl}/api/twilio/status`
    : undefined

  const results = await sendMany(
    tw.config,
    people.map((p) => ({ personId: p.id, phone: p.phone! })),
    text,
    { statusCallback }
  )

  await db.from('message_recipients').insert(
    results.map((r) => ({
      message_id: messageId,
      person_id: r.personId,
      phone: r.to,
      twilio_sid: r.sid ?? null,
      status: r.error ? 'failed' : (r.status ?? 'queued'),
      delivery_status: r.status ?? null,
      error: r.error ?? null,
      error_code: r.errorCode ?? null,
      segments: r.segments ?? verdict.info.segments,
      sent_at: r.error ? null : new Date().toISOString(),
    }))
  )

  // --- record that the intro text was sent ---
  //
  // This is what completes someone's consent: they opted in on the form, and this
  // send is the confirmation that closes the loop. Until it is stamped, they stay
  // outside the gate and would receive the intro again on every subsequent run.
  //
  // Only for recipients Twilio accepted. A failed send did not introduce anyone, and
  // marking it would quietly promote them into the eligible audience having never
  // heard from the club.
  if (incompleteConsent) {
    const introduced = results
      .filter((r) => !r.error && r.personId)
      .map((r) => r.personId as string)

    if (introduced.length) {
      await db
        .from('people')
        .update({ intro_sent_at: new Date().toISOString() })
        .in('id', introduced)
        // Never overwrite an earlier introduction — the first one is the one that
        // established consent, and its date is the one that matters.
        .is('intro_sent_at', null)
    }
  }

  const failed = results.filter((r) => r.error).length
  await db
    .from('messages')
    .update({
      // "sent" means every recipient was accepted. Partial failure is called out
      // rather than rounded up to success.
      status: failed === results.length ? 'failed' : 'sent',
      sent_at: new Date().toISOString(),
    })
    .eq('id', messageId)

  redirect(`/messages/${messageId}?sent=${results.length - failed}&failed=${failed}`)
}

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
import { additionsLength, checkSendability, composeBody } from '@/lib/sms/segments'
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
  opts: { series?: string; groupId?: string }
): Promise<{ people: GatePerson[]; bypass: boolean }> {
  const db = supabaseAdmin()

  const passesGate = (p: GatePerson) =>
    !!p.phone && !p.opted_out_at && !p.sms_never && !!p.opt_in_at && !!p.intro_sent_at

  // Reachable at all: enough to send to, regardless of consent. Used only by
  // audiences that legitimately bypass the gate.
  const reachable = (p: GatePerson) => !!p.phone && !p.opted_out_at

  switch (kind) {
    case 'group': {
      if (!opts.groupId) return { people: [], bypass: false }
      const { data: group } = await db
        .from('recipient_groups')
        .select('bypasses_consent_gate')
        .eq('id', opts.groupId)
        .single()
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

      const bypass = group?.bypasses_consent_gate === true
      return { people: people.filter(bypass ? reachable : passesGate), bypass }
    }

    case 'all_eligible': {
      const { data } = await db.from('people').select(GATE)
      return { people: ((data ?? []) as GatePerson[]).filter(passesGate), bypass: false }
    }

    case 'always': {
      const { data } = await db.from('people').select(GATE).eq('sms_always', true)
      return { people: ((data ?? []) as GatePerson[]).filter(passesGate), bypass: false }
    }

    case 'series':
    case 'series_intro': {
      if (!opts.series) return { people: [], bypass: false }
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

      if (kind === 'series') return { people: all.filter(passesGate), bypass: false }

      // Intro texts: the one audience that reaches people who have not passed the
      // gate, because receiving it is how they begin to. Restricted to race
      // entrants, and only those who have never had one.
      return {
        people: all.filter((p) => reachable(p) && !p.sms_never && !p.intro_sent_at),
        bypass: true,
      }
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
  const category = String(formData.get('category') ?? 'general')
  const purpose = String(formData.get('purpose') ?? '').trim() || null
  const repliesMonitored = formData.get('replies_monitored') === 'on'
  const replyNotice = repliesMonitored
    ? null
    : String(formData.get('reply_notice') ?? '').trim() || null
  const replyPersonId = String(formData.get('reply_person_id') ?? '') || null

  const fail = (msg: string) =>
    redirect(`/messages/compose?error=${encodeURIComponent(msg)}`)

  if (!body) fail('Nothing to send — the message is empty.')

  const tw = twilioConfig()
  if ('missing' in tw) {
    fail(`Sending is not configured yet. Missing: ${tw.missing.join(', ')}`)
    return
  }

  // Re-resolve on the server. Never trust a recipient list from the browser.
  const { people, bypass } = await recipientsFor(kind, { series, groupId })
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

  const { data: recent } = await duplicateQuery.limit(1).maybeSingle()

  if (recent) {
    const id = (recent as { id: string }).id
    fail(
      `That exact message was already sent to this audience in the last ` +
        `${DUPLICATE_WINDOW_MINUTES} minutes. If you meant to send it again, wait ` +
        `a few minutes or change the wording. Open /messages/${id} to see what went out.`
    )
  }

  const audience = await resolveAudience(kind, { series, groupId })

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
      bypassed_consent_gate: bypass,
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

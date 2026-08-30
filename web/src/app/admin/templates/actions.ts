'use server'

/**
 * Template management.
 *
 * Open to any signed-in officer, deliberately — NOT admin-only like groups.
 *
 * Groups decide who receives messages, which is why that screen is restricted. A
 * template decides only what a message says, and the person who writes these is the
 * membership director, who is a `processor` under the role split in RUNBOOK.md.
 * Requiring admin would mean Mary needed somebody else's help to fix her own wording,
 * and the predictable result of that is her going back to typing it by hand — which
 * is the problem templates exist to solve.
 *
 * Nothing here can send anything.
 */

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { fixSmartCharacters } from '@/lib/sms/segments'
import { TEMPLATE_CATEGORIES, unknownPlaceholders } from '@/lib/templates'

// Widened to string on purpose: this is checking an arbitrary form value, and a Set
// narrowed to the union would refuse to be asked about anything else — which is the
// one question worth asking here.
const VALID_CATEGORIES: ReadonlySet<string> = new Set<string>(
  TEMPLATE_CATEGORIES.map((c) => c.value)
)

interface Parsed {
  name: string
  category: string
  body: string
}

/**
 * Validate and clean a submitted template.
 *
 * THE CLEANING IS THE POINT, and it is why this cannot be left to the database. Two
 * of the eight real templates arrived with a curly apostrophe in "don't", inserted by
 * a Mac and invisible on screen. It forces UCS-2 and cuts a segment from 160
 * characters to 70 — the racer-profile message costs 5 segments as typed and 2 once
 * straightened. Typed into the compose box that gets fixed as you type; saved into a
 * template unfixed it becomes a 2.5x multiplier on every future send.
 *
 * @returns the cleaned values, or an error message to show the officer.
 */
function parse(formData: FormData): { ok: true; value: Parsed } | { ok: false; error: string } {
  const name = String(formData.get('name') ?? '').trim()
  const category = String(formData.get('category') ?? '').trim()
  const rawBody = String(formData.get('body') ?? '').trim()

  if (!name) return { ok: false, error: 'Give the template a name.' }
  if (!rawBody) return { ok: false, error: 'The message is empty.' }
  if (!VALID_CATEGORIES.has(category)) {
    return { ok: false, error: `“${category}” is not one of the template categories.` }
  }

  const { text: body } = fixSmartCharacters(rawBody)

  // A placeholder nothing can fill would be sent to a member as literal braces. Caught
  // on save rather than at send time: the officer writing it is the one who knows what
  // they meant, and they are here right now.
  const unknown = unknownPlaceholders(body)
  if (unknown.length) {
    return {
      ok: false,
      error:
        `${unknown.map((u) => `{${u}}`).join(', ')} ` +
        `${unknown.length === 1 ? 'is not a placeholder' : 'are not placeholders'} this ` +
        `system can fill in, so ${unknown.length === 1 ? 'it' : 'they'} would be sent to ` +
        `the member exactly as written. Use one of the listed placeholders, or write the ` +
        `words out.`,
    }
  }

  // Length is NOT checked. These messages run to 264 characters and that is fine —
  // they go to one person, not three hundred. The editor shows the segment count and
  // leaves the judgement where it belongs.
  return { ok: true, value: { name, category, body } }
}

const fail = (msg: string) =>
  redirect(`/admin/templates?error=${encodeURIComponent(msg)}`)

export async function createTemplate(formData: FormData) {
  const appUser = await requireAppUser()

  const parsed = parse(formData)
  if (!parsed.ok) return fail(parsed.error)

  const { error } = await supabaseAdmin()
    .from('message_templates')
    .insert({ ...parsed.value, created_by: appUser.userId })

  if (error) {
    return fail(
      error.code === '23505'
        ? `There is already a template called “${parsed.value.name}”.`
        : `Could not save the template: ${error.message}`
    )
  }

  revalidatePath('/admin/templates')
  revalidatePath('/messages/compose')
}

/**
 * Save a message being composed as a new template.
 *
 * Called from the compose screen with the body already re-abstracted — the caller
 * puts the placeholders back before sending it here, so what arrives should read
 * "Hello {first name}" and not "Hello Damian".
 *
 * This is checked rather than trusted. A body still containing the officer's own
 * contact number is refused: getting that wrong publishes one officer's mobile
 * through every future use of the template, and it would arrive silently.
 *
 * Returns a result rather than redirecting — the officer is mid-message and must not
 * be navigated away from it.
 */
export async function saveAsTemplate(input: {
  name: string
  category: string
  body: string
  /** The officer's own contact number, so we can refuse to store it. */
  officerPhone?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const appUser = await requireAppUser()

  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Give the template a name.' }
  if (!VALID_CATEGORIES.has(input.category)) {
    return { ok: false, error: 'Pick what kind of message this is.' }
  }

  const { text: body } = fixSmartCharacters(input.body.trim())
  if (!body) return { ok: false, error: 'There is no message to save.' }

  const unknown = unknownPlaceholders(body)
  if (unknown.length) {
    return {
      ok: false,
      error: `${unknown.map((u) => `{${u}}`).join(', ')} cannot be filled in, so it would be sent to members as written.`,
    }
  }

  // The guard that matters. Templates are shared between officers, so a literal
  // number in one is handed out by everybody who uses it.
  const digits = (input.officerPhone ?? '').replace(/\D/g, '')
  if (digits && body.replace(/\D/g, '').includes(digits)) {
    return {
      ok: false,
      error:
        'This still has your phone number written into it. Use {officer phone} so ' +
        'the template fills in whoever is sending it — otherwise every officer who ' +
        'uses this hands out your number.',
    }
  }

  const { error } = await supabaseAdmin()
    .from('message_templates')
    .insert({ name, category: input.category, body, created_by: appUser.userId })

  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? `There is already a template called “${name}”.`
          : `Could not save it: ${error.message}`,
    }
  }

  revalidatePath('/admin/templates')
  revalidatePath('/messages/compose')
  return { ok: true }
}

export async function updateTemplate(formData: FormData) {
  await requireAppUser()

  const id = String(formData.get('template_id') ?? '')
  if (!id) return

  const parsed = parse(formData)
  if (!parsed.ok) return fail(parsed.error)

  const { error } = await supabaseAdmin()
    .from('message_templates')
    .update(parsed.value)
    .eq('id', id)

  if (error) {
    return fail(
      error.code === '23505'
        ? `There is already a template called “${parsed.value.name}”.`
        : `Could not save the template: ${error.message}`
    )
  }

  revalidatePath('/admin/templates')
  revalidatePath('/messages/compose')
}

/**
 * Archive, rather than delete.
 *
 * A template that has been used is part of the record of how the club communicates,
 * and archiving is reversible where a delete is not. It also frees the name: the
 * unique index covers live templates only, so "Bib pickup" can be archived and
 * rewritten from scratch.
 */
export async function archiveTemplate(formData: FormData) {
  await requireAppUser()
  const id = String(formData.get('template_id') ?? '')
  if (!id) return

  await supabaseAdmin()
    .from('message_templates')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)

  revalidatePath('/admin/templates')
  revalidatePath('/messages/compose')
}

export async function restoreTemplate(formData: FormData) {
  await requireAppUser()
  const id = String(formData.get('template_id') ?? '')
  if (!id) return

  const { error } = await supabaseAdmin()
    .from('message_templates')
    .update({ archived_at: null })
    .eq('id', id)

  // Restoring can collide with a live template that took the name in the meantime.
  if (error) {
    return fail(
      error.code === '23505'
        ? 'A live template already has that name. Rename that one first, or rename ' +
            'this one after restoring it.'
        : `Could not restore the template: ${error.message}`
    )
  }

  revalidatePath('/admin/templates')
  revalidatePath('/messages/compose')
}

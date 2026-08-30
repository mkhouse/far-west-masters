/**
 * Your account.
 *
 * The officer's own settings, as distinct from /admin, which is about everyone
 * else's. Any signed-in officer can reach it; there is nothing here they could use to
 * affect another person.
 *
 * The screen exists for one field, and that field needs the explanation more than it
 * needs the form. An officer arriving here has been sent by a template that could not
 * fill {officer phone}, and the question in their head is "why does it not just use
 * my number?" — so the page answers that before it asks for anything.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { formatPhone } from '@/lib/format'
import { clearContactPhone, setContactPhone } from './actions'

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; cleared?: string }>
}) {
  const appUser = await requireAppUser()
  const { error, next, cleared } = await searchParams

  const db = supabaseAdmin()

  const { data: row } = await db
    .from('app_users')
    .select('contact_phone')
    .eq('user_id', appUser.userId)
    .maybeSingle()

  const contactPhone = (row?.contact_phone as string | null) ?? null

  // The number on their member record — offered as a suggestion, never as a default.
  // See migration 0030: this field exists precisely so that publishing that number is
  // a decision somebody makes rather than one the system makes for them.
  let memberPhone: string | null = null
  let firstName: string | null = null
  if (appUser.personId) {
    const { data: person } = await db
      .from('people')
      .select('first_name, phone')
      .eq('id', appUser.personId)
      .maybeSingle()
    memberPhone = (person?.phone as string | null) ?? null
    firstName = (person?.first_name as string | null) ?? null
  }

  const returnTo = next && next.startsWith('/') ? next : undefined

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-xl font-semibold">Your account</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Signed in as {appUser.email} ({appUser.role})
        {firstName && ` · templates will sign your messages “${firstName}”`}
      </p>

      {error && (
        <p
          className="mt-6 rounded-lg border border-fwm-burgundy/40 bg-fwm-burgundy/5 p-3 text-sm text-fwm-burgundy"
          role="alert"
        >
          {error}
        </p>
      )}

      {cleared && (
        <p className="mt-6 rounded-lg border border-neutral-200 bg-surface p-3 text-sm dark:border-neutral-800">
          Removed. Templates that need a contact number will no longer send until you
          set one.
        </p>
      )}

      <section className="mt-8 rounded-lg border border-neutral-200 bg-surface p-5 dark:border-neutral-800">
        <h2 className="font-medium">Contact number for members</h2>

        <p className="mt-2 text-sm text-neutral-600">
          The number templates fill into <code>{'{officer phone}'}</code> — the
          new-member welcome ends &ldquo;please give me a call at&hellip;&rdquo;. It
          goes out in a text to a member, so it is the number you are happy for members
          to call.
        </p>

        {/* The distinction this whole field exists for. Said plainly, because an
            officer who does not understand it will reasonably assume the system
            already knows their number — and it does, for a different purpose. */}
        <p className="mt-2 text-sm text-neutral-600">
          This is <strong>not</strong> the number on your member record. That one is
          where the club texts you and where member replies are forwarded; no member
          ever sees it. They are kept apart on purpose, so that using a shared template
          cannot hand out a number you never agreed to publish.
        </p>

        <div className="mt-4 rounded-md bg-neutral-50 px-4 py-3 text-sm dark:bg-neutral-900/50">
          {contactPhone ? (
            <>
              <span className="text-neutral-600">Members are given</span>{' '}
              <strong>{formatPhone(contactPhone)}</strong>
            </>
          ) : (
            <span className="text-neutral-600">
              Not set. Templates needing a contact number will not send.
            </span>
          )}
        </div>

        <form action={setContactPhone} className="mt-4">
          <input type="hidden" name="next" value={returnTo ?? ''} />
          <label className="block">
            <span className="text-sm font-medium">
              {contactPhone ? 'Change it to' : 'Set it to'}
            </span>
            <input
              name="contact_phone"
              inputMode="tel"
              autoComplete="tel"
              defaultValue={contactPhone ? formatPhone(contactPhone) : ''}
              placeholder="(530) 555-1234"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </label>

          {/* Offered, not prefilled. One click is a decision; a populated field is
              something you have to notice and undo. */}
          {memberPhone && memberPhone !== contactPhone && (
            <p className="mt-2 text-sm text-neutral-600">
              The number on your member record is{' '}
              <strong>{formatPhone(memberPhone)}</strong>. If you are happy for members
              to call it, paste it above &mdash; it is not filled in for you on
              purpose.
            </p>
          )}

          <button
            type="submit"
            className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Save
          </button>
        </form>

        {contactPhone && (
          <form action={clearContactPhone} className="mt-3">
            <button
              type="submit"
              className="text-sm text-neutral-600 underline"
            >
              Remove it
            </button>
          </form>
        )}
      </section>

      {returnTo && (
        <p className="mt-6 text-sm">
          <Link href={returnTo} className="text-fwm-navy underline">
            &larr; Back without saving
          </Link>
        </p>
      )}
    </main>
  )
}

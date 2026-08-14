/**
 * Public SMS opt-in form.
 *
 * Replaces the Airtable form. The wording is taken from it deliberately, close to
 * verbatim: it describes what members are consenting to, and it is what was
 * described to Twilio when the club's toll-free number was verified. Changing it
 * casually would put the two out of step.
 *
 * The only page in this application reachable without signing in. It writes to a
 * submissions table rather than to member records — see actions.ts.
 */

import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { submitOptIn } from './actions'

export const metadata: Metadata = {
  title: 'Text message opt-in — Far West Masters',
  description:
    'Opt in to receive race-day and time-sensitive text messages from Far West Masters.',
}

export default async function OptInPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>
}) {
  const { done, error } = await searchParams

  // Wording an admin can change without a deploy — see migration 0024.
  const { data: settings } = await supabaseAdmin()
    .from('app_settings')
    .select('key, value')
  const setting = (k: string, d: string) =>
    settings?.find((r) => r.key === k)?.value ?? d

  if (done) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-fwm-navy">
          Thank you
        </h1>
        <div className="mt-6 rounded-lg border border-neutral-200 bg-surface p-5 dark:border-neutral-800">
          <p className="text-base">
            {setting(
              'opt_in_intro_promise',
              'You will receive an introductory SMS message from Far West Masters shortly after you complete this form.'
            )}
          </p>
          {/* Said plainly, because the honest answer covers both cases: a matched
              member gets their text within seconds, and an unmatched one waits for
              somebody to check. Neither should feel like something went wrong. */}
          <p className="mt-3 text-sm text-neutral-600">
            If we cannot match your details to our membership list, an officer will
            check them first, and your introductory message may take a little
            longer.
          </p>
          <p className="mt-3 text-sm text-neutral-600">
            Questions? Email{' '}
            <a
              href="mailto:membership@farwestmasters.org"
              className="text-fwm-navy underline"
            >
              membership@farwestmasters.org
            </a>
            .
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-fwm-navy">
        Far West Masters SMS messaging opt-in
      </h1>
      <div className="mt-1 h-0.5 w-12 bg-fwm-burgundy" />

      {/* What the messages are and are not for. Kept from the Airtable form: a
          member deciding whether to consent deserves to know the answer before
          being asked, not afterwards. */}
      <div className="mt-6 space-y-4 text-base">
        <p>Far West Masters uses SMS messaging to notify members about:</p>
        <ul className="ml-5 list-disc space-y-1 text-neutral-700 dark:text-neutral-300">
          <li>Timely information for racers signed up for upcoming races</li>
          <li>Waivers which need to be signed</li>
          <li>
            Other timely membership information, directing to a webpage for more
            detail
          </li>
        </ul>

        <p>Far West Masters will not use SMS messaging for:</p>
        <ul className="ml-5 list-disc space-y-1 text-neutral-700 dark:text-neutral-300">
          <li>General announcements which are not time sensitive</li>
          <li>Non-FWM information or promotions</li>
        </ul>

        <p className="text-neutral-700 dark:text-neutral-300">
          {setting(
            'opt_in_intro_promise',
            'You will receive an introductory SMS message from Far West Masters shortly after you complete this form.'
          )}
        </p>
        <p className="text-neutral-700 dark:text-neutral-300">
          To opt out afterwards, reply <strong>STOP</strong> to any Far West Masters
          message. That unsubscribes you from all future messaging. Message
          frequency varies, and message and data rates may apply.
        </p>
      </div>

      {error && (
        <p
          className="mt-6 rounded-lg border border-fwm-burgundy/40 bg-fwm-burgundy/5 p-3 text-sm text-fwm-burgundy"
          role="alert"
        >
          {error}
        </p>
      )}

      <form
        action={submitOptIn}
        className="mt-8 space-y-5 rounded-lg border border-neutral-200 bg-surface p-5 dark:border-neutral-800"
      >
        {/* Honeypot: hidden from people, filled in by naive bots. Not `display:
            none`, which some bots skip — moved off-screen instead. */}
        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">First name</span>
            <input
              name="first_name"
              required
              autoComplete="given-name"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Last name</span>
            <input
              name="last_name"
              required
              autoComplete="family-name"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
          />
          <span className="mt-1 block text-sm text-neutral-600">
            So we can check your details against our membership list.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Mobile phone</span>
          <input
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            inputMode="tel"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
          />
          <span className="mt-1 block text-sm text-neutral-600">
            The number we will send messages to.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium">
            USSA number{' '}
            <span className="font-normal text-neutral-600">(optional)</span>
          </span>
          <input
            name="usssa"
            inputMode="numeric"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
          />
          <span className="mt-1 block text-sm text-neutral-600">
            Helps us match you to the right record. The letter prefix is fine.
          </span>
        </label>

        <label className="flex items-start gap-3">
          <input type="checkbox" name="consent" required className="mt-1.5" />
          <span className="text-base">
            {setting(
              'opt_in_consent_label',
              'By checking this box, I consent to opt-in to Far West Masters SMS messaging.'
            )}
          </span>
        </label>

        <button
          type="submit"
          className="w-full rounded-md bg-fwm-navy px-4 py-2.5 font-medium text-white"
        >
          Submit
        </button>
      </form>

      <p className="mt-6 text-sm text-neutral-600">
        Questions? Email{' '}
        <a
          href="mailto:membership@farwestmasters.org"
          className="text-fwm-navy underline"
        >
          membership@farwestmasters.org
        </a>
        .
      </p>
    </main>
  )
}

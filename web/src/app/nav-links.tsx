'use client'

/**
 * The main navigation, with the current section underlined.
 *
 * A client component only because it needs the current path. Knowing where you are
 * matters more here than in most apps: the three sections look similar at a glance,
 * and one of them sends texts to three hundred people.
 *
 * Matching is by prefix, so /messages/compose and /messages/<id> both keep
 * "Messages" lit, and /admin/groups keeps "Admin" lit. Without that, the indicator
 * would vanish exactly when you had navigated somewhere — which is worse than
 * having none.
 *
 * Counts arrive as `badges`, keyed by href. A review queue nobody is told about is
 * the same as no review queue, and the people in it have consented and are waiting
 * to hear from the club.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SECTIONS = [
  { href: '/messages', label: 'Messages' },
  { href: '/members', label: 'Members' },
  { href: '/admin', label: 'Admin' },
]

export function NavLinks({ badges = {} }: { badges?: Record<string, number> }) {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-6 text-sm">
      {SECTIONS.map((s) => {
        const active = pathname === s.href || pathname.startsWith(`${s.href}/`)

        return (
          <Link
            key={s.href}
            href={s.href}
            // The underline sits just under the word rather than at the bottom of
            // the bar. Stretched to full height it reads as a rule floating in
            // space, disconnected from the label it belongs to.
            //
            // The transparent border on inactive links keeps the row from shifting
            // by a pixel as you move between sections.
            className={`border-b-2 pb-1 transition-colors ${
              active
                ? 'border-fwm-navy font-medium text-fwm-navy'
                : 'border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            {s.label}
            {/* Keyed by href rather than named per section, so the nav does not
                need to know what any particular count means. */}
            {/* Inverted on the section you are already on. Filled navy, the badge
                sat beside navy label text and a navy underline — three navies in an
                inch, and the count was the one least able to be picked out of them.
                A cream pill with a navy number separates by figure and ground
                instead of by hue.

                Both states ride --fwm-navy and --background, which invert together
                in dark mode, so neither needs a dark: variant. The exception is the
                white number on the filled pill: in the dark the navy is lifted to
                #7ea8d4, where white falls to 2.5:1 and fails for 12px text, so it
                flips to near-black there instead. */}
            {badges[s.href] ? (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-medium ${
                  active
                    ? 'bg-background text-fwm-navy ring-1 ring-fwm-navy'
                    : 'bg-fwm-navy text-white dark:text-neutral-950'
                }`}
              >
                {badges[s.href]}
                {/* The number alone reads as "Admin 2". Screen readers get the
                    sentence a sighted reader infers from the context.

                    Deliberately not "waiting for review", which this said until the
                    count grew to cover people awaiting an intro text and people
                    whose number was rejected. Neither of those is reviewed. */}
                <span className="sr-only"> needing action</span>
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

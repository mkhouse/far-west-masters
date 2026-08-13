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
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SECTIONS = [
  { href: '/messages', label: 'Messages' },
  { href: '/members', label: 'Members' },
  { href: '/admin', label: 'Admin' },
]

export function NavLinks() {
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
          </Link>
        )
      })}
    </nav>
  )
}

'use client'

/**
 * Copy every email address in the current filtered list.
 *
 * The club's email — the Forerunner, race announcements — is sent from somewhere
 * else entirely. This exists so that a list worked out here ("active members
 * missing a USSA number") can be acted on there, without exporting a file or
 * copying addresses one at a time.
 *
 * Note what it does NOT consider: SMS consent. Opting out of texts is not opting
 * out of email, and the two have never been the same decision. This copies whoever
 * is on screen.
 */

import { useState } from 'react'

export function CopyEmailsButton({ emails }: { emails: string[] }) {
  const [copied, setCopied] = useState(false)

  // De-duplicated, because a shared household address would otherwise appear twice
  // and most mail clients will not thank you for it.
  const unique = Array.from(new Set(emails.filter(Boolean)))

  async function copy() {
    try {
      await navigator.clipboard.writeText(unique.join(', '))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard refused — nothing useful to do, and the list is still on screen.
    }
  }

  if (unique.length === 0) return null

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:border-fwm-navy dark:border-neutral-700"
    >
      {copied
        ? `Copied ${unique.length}`
        : `Copy ${unique.length} email ${unique.length === 1 ? 'address' : 'addresses'}`}
    </button>
  )
}

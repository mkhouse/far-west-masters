'use client'

/**
 * Copy a phone number or email to the clipboard.
 *
 * Selecting a phone number by dragging is fiddly, and a mistyped digit means a
 * text to a stranger. One click removes both problems.
 *
 * Shows a tick for a moment afterwards. Without that there is no way to tell
 * whether the click registered, and the natural response to silence is to click
 * again and wonder.
 */

import { useState } from 'react'

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be refused — an insecure origin, or a browser that
      // wants a permission we do not have. Failing quietly is right here: the
      // value is on screen and can still be selected by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      // The value is in the label rather than just "Copy", because a screen reader
      // running through a list of members would otherwise hear "copy" forty times
      // with nothing to distinguish them.
      aria-label={`Copy ${label} ${value}`}
      title={copied ? 'Copied' : `Copy ${label}`}
      className="ml-1.5 inline-flex align-middle text-neutral-400 transition-colors hover:text-fwm-navy"
    >
      {copied ? (
        <svg className="h-4 w-4 text-fwm-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" strokeLinecap="round" />
        </svg>
      )}
    </button>
  )
}

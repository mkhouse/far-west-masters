/** Time parsing/formatting shared by the parsers and the scorer. */

const NON_FINISH = /^(DNF|DNS|DSQ|DQ)/i

export function isNonFinish(s: string | null | undefined): boolean {
  return !!s && NON_FINISH.test(s.trim())
}

/** Normalize ACE's DSQ variants (DQg23, DQ, dsq) to 'DSQ'. */
export function normalizeStatus(raw: string): string {
  const s = raw.trim().toUpperCase()
  if (s.startsWith('DQ') || s === 'DSQ') return 'DSQ'
  if (s === 'DNF') return 'DNF'
  if (s === 'DNS') return 'DNS'
  return raw.trim()
}

/**
 * '34.37' or '1:07.49' or '1:02:03.10' -> seconds.
 * Returns null for statuses and anything unparseable.
 */
export function timeToSeconds(s: string | null | undefined): number | null {
  if (!s) return null
  const t = s.trim()
  if (isNonFinish(t)) return null

  const parts = t.split(':')
  if (parts.length === 1) {
    const v = parseFloat(parts[0]!)
    return Number.isNaN(v) ? null : v
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0]!, 10)
    const sec = parseFloat(parts[1]!)
    if (Number.isNaN(m) || Number.isNaN(sec)) return null
    return m * 60 + sec
  }
  if (parts.length === 3) {
    const h = parseInt(parts[0]!, 10)
    const m = parseInt(parts[1]!, 10)
    const sec = parseFloat(parts[2]!)
    if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(sec)) return null
    return h * 3600 + m * 60 + sec
  }
  return null
}

/**
 * Truncate a time to hundredths.
 *
 * Ski racing times are **truncated**, never rounded — 171.1850 is 171.18, not
 * 171.19. Verified against the published cup results, where rounding disagrees
 * with ACE on roughly half of all racers and truncation matches.
 *
 * The epsilon guards against binary floating-point representation turning an
 * exact hundredth like 91.02 into 91.019999..., which would truncate a cent low.
 */
export function truncateToHundredths(totalSeconds: number): number {
  return Math.floor(totalSeconds * 100 + 1e-6) / 100
}

/**
 * seconds -> 'SS.SS' under a minute, otherwise 'M:SS.SS'.
 * Truncates rather than rounds, per the convention above.
 */
export function secondsToDisplay(totalSeconds: number): string {
  const t = truncateToHundredths(totalSeconds)
  if (t < 60) return t.toFixed(2)
  const mins = Math.floor(t / 60)
  const secs = (t % 60).toFixed(2).padStart(5, '0')
  return `${mins}:${secs}`
}

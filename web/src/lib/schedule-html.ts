/**
 * Extract a table from the published schedule page.
 *
 * Deliberately NOT marked `server-only` — pure string handling, no key, request or
 * database, same as format.ts and phone.ts. That keeps it testable against the
 * archived files without a database.
 *
 * WHY A PARSER AND NOT A REGEX. The obvious `/<tr>(.*?)<\/tr>/g` silently drops every
 * row whose closing tag is missing or whose class attribute makes the opening tag not
 * match. On the real 2026-27 file that regex found 9 rows out of 12 — it lost the
 * three `out-of-region` races and two others, and reported a clean-looking answer
 * while doing it. A schedule importer that quietly omits three races is worse than
 * one that refuses to run, because nothing downstream can tell.
 *
 * So this is a small tag scanner instead. It is not a general HTML parser and does not
 * try to be: it handles the one shape farwestmasters.org publishes, and the structure
 * it depends on is asserted in schedule-html.test.ts against both archived seasons.
 *
 * THE `<br>` RULE, which is what makes the page parseable at all. Every busy cell is
 * real content followed by metadata, separated by line breaks:
 *
 *   Disciplines:  "GS / GS <br><br> Race: TBA <br> Start: TBA"
 *   Date:         "Feb. 28-Mar. 1 <br> (Sat-Sun) RESCHEDULED TO MAR 14-15"
 *
 * So a cell is returned as its `<br>`-separated segments rather than one flattened
 * string, and callers take the segment they need. Flattening first and then trying to
 * strip "Race: TBA" back out with patterns is how this becomes unmaintainable.
 */

/** One `<td>`/`<th>`, split on its line breaks. */
export interface Cell {
  /** Segments between `<br>` tags, trimmed, with empties preserved as ''. */
  segments: string[]
  /** Everything joined with a space — for searching, not for parsing. */
  text: string
}

export interface Row {
  /** The `class` attribute, which is where this page records race status. */
  className: string | null
  cells: Cell[]
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  hellip: '...',
  bull: '*',
}

/**
 * Decode the entities this page actually uses.
 *
 * Note the deliberate choice of replacements: `&mdash;` becomes a hyphen and
 * `&rsquo;` a straight apostrophe, rather than the typographic characters. Venue and
 * event names parsed from here can end up in an SMS, where an em dash or a curly
 * apostrophe forces UCS-2 and cuts the segment from 160 characters to 70. Decoding to
 * the pretty character and relying on fixSmartCharacters() to undo it later works,
 * but only as long as every path remembers to call it — this way there is nothing to
 * remember.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
}

/** Collapse runs of whitespace, including the newlines the source file is full of. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Read the `class` attribute off an opening tag, if it has one. */
function classOf(tag: string): string | null {
  const match = /\bclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
  const value = match?.[2] ?? match?.[3] ?? match?.[4]
  return value ? tidy(decodeEntities(value)) : null
}

/**
 * Every row of every table on the page, in document order.
 *
 * Rows are closed by the next `<tr>` as well as by `</tr>`, and cells by the next
 * cell as well as by their own closing tag. That tolerance is the entire point: the
 * published page omits closing tags in places, and a parser that requires them loses
 * races without saying so.
 */
export function parseRows(html: string): Row[] {
  const rows: Row[] = []

  let row: Row | null = null
  let cellSegments: string[] | null = null
  let buffer = ''

  /** Finish the cell in progress, if any. */
  const closeCell = () => {
    if (!cellSegments || !row) return
    cellSegments.push(tidy(decodeEntities(buffer)))
    const segments = cellSegments
    row.cells.push({
      segments,
      text: tidy(segments.filter(Boolean).join(' ')),
    })
    cellSegments = null
    buffer = ''
  }

  const closeRow = () => {
    closeCell()
    if (row && row.cells.length) rows.push(row)
    row = null
  }

  // Walk tag by tag; everything between tags is text belonging to the open cell.
  const tagPattern = /<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi
  let last = 0
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(html)) !== null) {
    if (cellSegments) buffer += html.slice(last, match.index)
    last = tagPattern.lastIndex

    const whole = match[0]
    const name = match[1].toLowerCase()
    const closing = whole.startsWith('</')

    if (name === 'tr') {
      if (closing) closeRow()
      else {
        // An unclosed previous row ends here rather than swallowing this one.
        closeRow()
        row = { className: classOf(whole), cells: [] }
      }
    } else if (name === 'td' || name === 'th') {
      if (closing) closeCell()
      else {
        closeCell()
        if (row) cellSegments = []
      }
    } else if (name === 'br' && cellSegments) {
      // The structural break this page uses to separate content from metadata.
      cellSegments.push(tidy(decodeEntities(buffer)))
      buffer = ''
    } else if (name === 'table' && closing) {
      closeRow()
    }
    // Every other tag — <a>, <strong>, <span> — contributes only its text.
  }

  closeRow()
  return rows
}

/**
 * The schedule table's data rows, with the header row dropped.
 *
 * The header is identified by content rather than by `<th>`, because a row of `<td>`
 * holding "Date | Location | ..." is still a header and has appeared as one.
 */
export function scheduleRows(html: string): Row[] {
  const rows = parseRows(html).filter((r) => r.cells.length >= 4)
  const first = rows[0]
  const isHeader =
    first &&
    first.cells[0]?.text.toLowerCase() === 'date' &&
    first.cells[1]?.text.toLowerCase() === 'location'

  return isHeader ? rows.slice(1) : rows
}

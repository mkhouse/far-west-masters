/**
 * Reading AdminSkiRacing's CSV exports.
 *
 * Pure, so it can be tested without a database, and shared by the membership import
 * (#52) and the race roster import (#24) — both come from the same system in the
 * same shape.
 *
 * THE TRAP THIS EXISTS FOR: these files contain newlines INSIDE quoted fields. One
 * member's medical notes in the 2025-2026 export run to three lines. Split the file
 * on newlines and that row is mangled, along with every column after it — and the
 * damage is invisible, because the result is still a table, just with one member's
 * phone number holding part of somebody's address.
 *
 * The same trap appeared independently in the Airtable backup, where a Notes field
 * made 309 people read as 626 rows. It is a property of this data, not one bad
 * export, so nothing here may assume a line is a record.
 */

export type CsvRow = Record<string, string>

/**
 * Split CSV text into rows of fields.
 *
 * Character by character rather than by line, handling quoted fields, embedded
 * commas, embedded newlines and doubled quotes ("" for a literal quote).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (inQuotes) {
      if (c === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        // Newlines land here, and are kept — this is the whole point of the file.
        field += c
      }
      continue
    }

    if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }

  // Whatever the file ended with, mid-field or mid-row.
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }

  // Blank lines are not records. Trailing ones are common in exported files.
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

/**
 * Parse into objects keyed by the header row.
 *
 * Header names are trimmed but otherwise left exactly as ASR writes them — "USSA#",
 * "FarWest Bib Number" — so the column list in the importer can be checked against
 * the export by eye.
 */
export function parseAsrCsv(text: string): CsvRow[] {
  const rows = parseCsv(text)
  if (rows.length < 2) return []

  const header = rows[0].map((h) => h.trim())

  return rows.slice(1).map((r) => {
    const out: CsvRow = {}
    header.forEach((key, i) => {
      out[key] = (r[i] ?? '').trim()
    })
    return out
  })
}

/**
 * Check the columns the importer depends on are present.
 *
 * ASR could reasonably rename or drop a column between seasons. Failing with "the
 * export is missing USSA#" is recoverable; silently importing 168 members with no
 * identifiers is not.
 */
export function missingColumns(rows: CsvRow[], required: string[]): string[] {
  if (rows.length === 0) return required
  const present = new Set(Object.keys(rows[0]))
  return required.filter((c) => !present.has(c))
}

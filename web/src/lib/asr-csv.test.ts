/**
 * Reading AdminSkiRacing's CSV exports.
 *
 * The case that matters most is the embedded newline. It has now appeared twice in
 * real data from two different systems — a member's medical notes in the ASR export,
 * and a Notes field in the Airtable backup that made 309 people read as 626 rows —
 * so it is a property of this data rather than one bad file.
 *
 * What makes it dangerous is that it fails quietly. A line-based reader still
 * produces a table; it just has one member's phone number holding part of somebody
 * else's address, and nothing looks wrong until a text goes to the wrong number.
 */

import { describe, expect, it } from 'vitest'
import { missingColumns, parseAsrCsv, parseCsv } from './asr-csv'

describe('parseCsv', () => {
  it('reads a plain file', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('name,note\n"Lovelace, Ada",fine')).toEqual([
      ['name', 'note'],
      ['Lovelace, Ada', 'fine'],
    ])
  })

  // THE ONE. A newline inside quotes is data, not a record boundary.
  it('keeps newlines inside quoted fields', () => {
    const text = 'name,notes,phone\n"Ada","line one\nline two\nline three","+15305551234"'
    const rows = parseCsv(text)

    expect(rows).toHaveLength(2)
    expect(rows[1][1]).toBe('line one\nline two\nline three')
    // The column after the multi-line field is the one a naive reader corrupts.
    expect(rows[1][2]).toBe('+15305551234')
  })

  it('does not lose the rows after a multi-line field', () => {
    const text = 'name,notes\n"Ada","two\nlines"\n"Grace","one line"\n"Alan","also one"'
    const rows = parseCsv(text)
    expect(rows).toHaveLength(4)
    expect(rows[2][0]).toBe('Grace')
    expect(rows[3][0]).toBe('Alan')
  })

  it('reads a doubled quote as a literal quote', () => {
    expect(parseCsv('name\n"Ada ""Countess"" Lovelace"')[1][0]).toBe(
      'Ada "Countess" Lovelace'
    )
  })

  it('handles Windows line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('drops blank lines rather than reading them as records', () => {
    // Exported files routinely end with one, and an empty member is not a member.
    expect(parseCsv('a,b\n1,2\n\n')).toHaveLength(2)
  })

  it('keeps a row whose fields are empty but present', () => {
    // ",," is three empty fields and no data; "1,," is a record with two blanks.
    expect(parseCsv('a,b,c\n1,,')).toHaveLength(2)
  })

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('does not lose a final row with no trailing newline', () => {
    expect(parseCsv('a\n1\n2')).toHaveLength(3)
  })
})

describe('parseAsrCsv', () => {
  it('keys fields by the header row', () => {
    const rows = parseAsrCsv('"First Name","USSA#"\n"Ada","F5276696"')
    expect(rows[0]['First Name']).toBe('Ada')
    expect(rows[0]['USSA#']).toBe('F5276696')
  })

  it('trims whitespace from headers and values', () => {
    const rows = parseAsrCsv(' First Name , USSA# \n Ada , F5276696 ')
    expect(rows[0]['First Name']).toBe('Ada')
    expect(rows[0]['USSA#']).toBe('F5276696')
  })

  it('gives an empty string for a column the row does not reach', () => {
    // A short row must not produce undefined, which would read as a missing column
    // rather than a blank value.
    const rows = parseAsrCsv('a,b,c\n1')
    expect(rows[0].c).toBe('')
  })

  it('returns nothing for a header with no rows', () => {
    expect(parseAsrCsv('a,b,c')).toEqual([])
  })
})

describe('missingColumns', () => {
  // ASR could rename or drop a column between seasons. Failing with "the export is
  // missing USSA#" is recoverable; importing 168 members with no identifiers is not.
  it('names what is missing', () => {
    const rows = parseAsrCsv('"First Name","Last Name"\n"Ada","Lovelace"')
    expect(missingColumns(rows, ['First Name', 'USSA#'])).toEqual(['USSA#'])
  })

  it('is satisfied when everything is present', () => {
    const rows = parseAsrCsv('"First Name","USSA#"\n"Ada","F1"')
    expect(missingColumns(rows, ['First Name', 'USSA#'])).toEqual([])
  })

  it('treats an empty file as missing everything', () => {
    expect(missingColumns([], ['First Name'])).toEqual(['First Name'])
  })
})

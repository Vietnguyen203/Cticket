export type Cell = string | number | null | undefined

/** Excel runs a cell starting with these as a formula (event titles are typed by users). */
const FORMULA_START = /^[=+\-@\t\r]/

function cell(value: Cell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  const text = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * CSV for Excel: UTF-8 with a BOM (else Vietnamese turns into mojibake),
 * comma separated, CRLF line ends, money as plain integers so it can be summed.
 */
export function toCsv(rows: Cell[][]): string {
  return '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** Save the rows as a file (built in the browser: no extra request, no token in a URL). */
export function downloadCsv(filename: string, rows: Cell[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

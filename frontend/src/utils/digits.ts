/**
 * Whole numbers typed in a form (prices, capacities, limits), shown the
 * Vietnamese way: "." between thousands (1.500.000). The form keeps the bare
 * digits ("1500000"), so Number(value) and the API see a plain number.
 */

/** The digits of what was typed or pasted ("1.500.000 ₫" → "1500000"), without leading zeros. */
export function onlyDigits(text: string): string {
  return text.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}

/** "1500000" → "1.500.000"; "" stays "". */
export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Where the caret goes in `grouped` to stay after the same number of digits as before. */
export function caretAfterDigits(grouped: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0
  let seen = 0
  for (let i = 0; i < grouped.length; i += 1) {
    if (/\d/.test(grouped[i])) seen += 1
    if (seen === digitsBefore) return i + 1
  }
  return grouped.length
}

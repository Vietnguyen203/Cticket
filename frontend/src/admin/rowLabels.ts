/** Same rule as the API: a row label is 1–5 letters or digits. */
const LABEL = /^[A-Z0-9]{1,5}$/
const MAX_ROWS = 100

/**
 * Row labels typed by the admin: "A-E", "A, B, F", "AA-AC" is not a range
 * (one letter only), "1-3" for numbered rows. Returns null when the input is invalid.
 *
 *   parseRowLabels('A-C, F') → ['A', 'B', 'C', 'F']
 */
export function parseRowLabels(input: string): string[] | null {
  const labels: string[] = []
  for (const part of input.toUpperCase().split(',').map((p) => p.trim()).filter(Boolean)) {
    const range = /^([A-Z]|\d{1,3})\s*-\s*([A-Z]|\d{1,3})$/.exec(part)
    if (range) {
      const [from, to] = [range[1], range[2]]
      const numeric = /^\d+$/.test(from)
      if (numeric !== /^\d+$/.test(to)) return null
      const start = numeric ? Number(from) : from.charCodeAt(0)
      const end = numeric ? Number(to) : to.charCodeAt(0)
      if (end < start) return null
      for (let code = start; code <= end; code += 1) labels.push(numeric ? String(code) : String.fromCharCode(code))
    } else if (LABEL.test(part)) {
      labels.push(part)
    } else {
      return null
    }
  }
  const unique = [...new Set(labels)]
  return unique.length > 0 && unique.length <= MAX_ROWS ? unique : null
}

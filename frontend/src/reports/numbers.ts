/** Short money for chart axes and tight cells: 350 N, 1,2 tr, 2,5 tỷ. */
export function shortVnd(amount: number): string {
  const abs = Math.abs(amount)
  const fmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
  if (abs >= 1e9) return `${fmt(amount / 1e9)} tỷ`
  if (abs >= 1e6) return `${fmt(amount / 1e6)} tr`
  if (abs >= 1e3) return `${fmt(amount / 1e3)} N`
  return String(amount)
}

/**
 * A round top for the y axis (1, 2, 2.5 or 5 × 10^n, ≥ max) and its 4 equal
 * steps, so the grid lines land on readable values.
 */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 0.25, 0.5, 0.75, 1] }
  const power = 10 ** Math.floor(Math.log10(max))
  const top = [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= max) ?? 10 * power
  return { top, ticks: [0, 1, 2, 3, 4].map((i) => (top * i) / 4) }
}

export const percent = (rate: number | null) => (rate === null ? '—' : `${(rate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`)

/** "2026-10-13" → "13/10" */
export const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`

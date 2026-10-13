/** Report days are Vietnamese calendar days, "YYYY-MM-DD" (the API speaks the same). */
const DAY_MS = 86_400_000
const vnDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })

export const vnToday = (now = Date.now()) => vnDay.format(new Date(now))

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

export type RangePreset = '7d' | '30d' | 'month' | 'lastMonth'

/** The quick ranges of the report page, ending today at the latest. */
export function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  const monthStart = `${today.slice(0, 8)}01`
  switch (preset) {
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case 'month':
      return { from: monthStart, to: today }
    case 'lastMonth': {
      const lastDay = addDays(monthStart, -1)
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay }
    }
  }
}

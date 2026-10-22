/**
 * The time part of a DateTimeField: typed as HH:mm, 24-hour clock (00:00 →
 * 23:59). Typing is helped, never guessed at: digits only, the ":" is added
 * after the hour.
 */

const TIME_24 = /^([01]\d|2[0-3]):([0-5]\d)$/

/** What the box shows while typing: up to 4 digits, "19" → "19", "193" → "19:3", "1930" → "19:30". */
export function formatTimeInput(raw: string): string {
  // A typed ":" after one digit means a one-digit hour ("9:30").
  const oneDigitHour = /^\d:/.test(raw)
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (oneDigitHour) return digits.length > 1 ? `0${digits[0]}:${digits.slice(1, 3)}` : `0${digits}:`
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits
}

/**
 * A complete, valid 24-hour time ("HH:mm"), or null. Accepts "19:30", "1930",
 * "9:30" and "0930"; a bare hour ("19") is not a time yet.
 */
export function parseTime24(input: string): string | null {
  const text = input.trim()
  const withColon = /^\d{3,4}$/.test(text) ? `${text.slice(0, -2)}:${text.slice(-2)}` : text
  const padded = /^\d:\d\d$/.test(withColon) ? `0${withColon}` : withColon
  return TIME_24.test(padded) ? padded : null
}

/** Why a typed time is not usable ('' while it is empty or still being typed). */
export function timeProblem(input: string, finished: boolean): string {
  const text = input.trim()
  if (!text || parseTime24(text)) return ''
  // "25", "19:7": wrong already, or only wrong once the person has left the box.
  const impossible = /^(2[4-9]|[3-9]\d)/.test(text.replace(':', '')) || /:[6-9]/.test(text)
  return finished || impossible ? 'Giờ theo 24 giờ, từ 00:00 đến 23:59 (ví dụ 19:30).' : ''
}

/** Date chosen and time not (or the other way round): the field's value stays '' and the form cannot use it yet. */
export function partlyFilled(parts: { date: string; time: string }): boolean {
  return Boolean(parts.date) !== Boolean(parts.time.trim())
}

const DEFAULT_SHOW_HOURS = 3

/** "YYYY-MM-DD" + n days (calendar arithmetic, no time zone involved). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * A show from one date and typed 24-hour times (Vietnam time, "YYYY-MM-DDTHH:mm").
 * end: optional; empty = start + 3 hours; earlier than start = after midnight
 * (the next day). '' while the date or the start time is missing / invalid.
 */
export function showTimes(date: string, start: string, end: string): { startAt: string; endAt: string } {
  const from = parseTime24(start)
  if (!date || !from) return { startAt: '', endAt: '' }
  const startAt = `${date}T${from}`
  if (end.trim() && !parseTime24(end)) return { startAt, endAt: '' }
  const to = parseTime24(end)
  if (!to) {
    const [h, m] = from.split(':').map(Number)
    const minutes = h * 60 + m + DEFAULT_SHOW_HOURS * 60
    const day = addDays(date, Math.floor(minutes / 1440))
    const rest = minutes % 1440
    return { startAt, endAt: `${day}T${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}` }
  }
  return { startAt, endAt: `${to <= from ? addDays(date, 1) : date}T${to}` }
}

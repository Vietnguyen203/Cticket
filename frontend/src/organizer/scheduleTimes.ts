import type { ApiError } from '../api/errors'
import { showTimes } from '../utils/dateTimeParts'
import { formatDateTime } from '../utils/format'
import { fromVnInput, toVnInput } from '../utils/vnTime'

/** Longer than this, a show is most likely a typing mistake (an end date one day too late). */
export const LONG_SHOW_HOURS = 12

/** How long a show lasts, in hours (rounded to one decimal). */
export const showHours = (startAt: string, endAt: string) => Math.round(((new Date(endAt).getTime() - new Date(startAt).getTime()) / 3_600_000) * 10) / 10

/**
 * SCHEDULE_CONFLICT with the show in the way (the API sends its times, and
 * whether it belongs to this event): what to say so the organizer knows what
 * to change. null for any other error.
 */
export function conflictMessage(error: ApiError): string | null {
  if (error.code !== 'SCHEDULE_CONFLICT' || !Array.isArray(error.details)) return null
  const conflict = (error.details[0] as { conflict?: { startAt: string; endAt: string; sameEvent: boolean } } | undefined)?.conflict
  if (!conflict) return null
  const when = `${formatDateTime(conflict.startAt)} → ${formatDateTime(conflict.endAt)}`
  if (!conflict.sameEvent) return `Địa điểm đã có suất của một sự kiện khác lúc ${when}. Chọn giờ khác.`
  const hours = showHours(conflict.startAt, conflict.endAt)
  const long = hours > LONG_SHOW_HOURS ? ` Suất đó kéo dài ${hours} giờ: có thể giờ kết thúc bị nhập nhầm, sửa giờ ở dòng của suất đó trong danh sách rồi bấm "Lưu".` : ''
  return `Trùng giờ với một suất khác của sự kiện này (${when}).${long}`
}

/** One line of the schedule list, as typed (Vietnam time). */
export interface ScheduleRowInput {
  date: string
  start: string
  end: string
  salesStartAt: string
  salesEndAt: string
}

export const EMPTY_ROW: ScheduleRowInput = { date: '', start: '', end: '', salesStartAt: '', salesEndAt: '' }

/** A saved schedule as a line of the list. */
export function rowOf(schedule: { startAt: string; endAt: string; salesStartAt: string; salesEndAt: string }): ScheduleRowInput {
  const start = toVnInput(schedule.startAt)
  return {
    date: start.slice(0, 10),
    start: start.slice(11, 16),
    end: toVnInput(schedule.endAt).slice(11, 16),
    salesStartAt: toVnInput(schedule.salesStartAt),
    salesEndAt: toVnInput(schedule.salesEndAt),
  }
}

/**
 * What to send for a line: a new schedule (no `saved`), or only what changed
 * on a saved one. Sales closing at the show start (the default) follow the
 * start when it moves. null: the times are not complete / valid yet.
 */
export function scheduleBody(
  row: ScheduleRowInput,
  saved?: { startAt: string; endAt: string; salesStartAt: string; salesEndAt: string },
): Record<string, string> | null {
  const times = showTimes(row.date, row.start, row.end)
  if (!times.startAt || !times.endAt) return null
  const wanted: Record<string, string> = { startAt: times.startAt, endAt: times.endAt }
  if (!saved) {
    if (row.salesStartAt) wanted.salesStartAt = row.salesStartAt
    if (row.salesEndAt) wanted.salesEndAt = row.salesEndAt
    return Object.fromEntries(Object.entries(wanted).map(([key, value]) => [key, fromVnInput(value) ?? value]))
  }
  const before = { startAt: toVnInput(saved.startAt), endAt: toVnInput(saved.endAt), salesStartAt: toVnInput(saved.salesStartAt), salesEndAt: toVnInput(saved.salesEndAt) }
  const followsStart = row.salesEndAt === before.salesEndAt && before.salesEndAt === before.startAt
  wanted.salesStartAt = row.salesStartAt
  wanted.salesEndAt = followsStart ? times.startAt : row.salesEndAt
  const changed = Object.entries(wanted).filter(([key, value]) => value && value !== before[key as keyof typeof before])
  return Object.fromEntries(changed.map(([key, value]) => [key, fromVnInput(value) ?? value]))
}

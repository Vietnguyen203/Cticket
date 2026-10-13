import type { CheckInResult } from '../api/checkins'
import type { ApiError } from '../api/errors'
import { formatDateTime, formatTime } from '../utils/format'

export interface ScanOutcome {
  ok: boolean
  title: string
  lines: string[]
}

/** What the gate shows after a scan: green with the seat to check, or red with the reason (CHK-01). */
export function toScanOutcome(result: { ok: true; data: CheckInResult } | { ok: false; error: ApiError }): ScanOutcome {
  if (result.ok) {
    const { ticket, stats } = result.data
    return {
      ok: true,
      title: 'Mời vào',
      lines: [
        `${ticket.ticketTypeName} · ${ticket.seatLabel ?? `vé đứng #${ticket.admissionNo}`}`,
        ticket.code,
        ...(stats ? [`Đã vào ${stats.checkedIn} / ${stats.total}`] : []),
      ],
    }
  }
  const { code, details, message } = result.error
  const d = (details ?? {}) as Record<string, unknown>
  switch (code) {
    case 'TICKET_ALREADY_USED':
      return {
        ok: false,
        title: 'Vé đã được sử dụng',
        lines: [
          d.checkedInAt ? `Đã vào lúc ${formatTime(String(d.checkedInAt))}` : '',
          d.deviceId ? `Tại: ${String(d.deviceId)}` : '',
          d.staffName ? `Nhân viên: ${String(d.staffName)}` : '',
        ].filter(Boolean),
      }
    case 'WRONG_SCHEDULE': {
      const schedule = d.schedule as { startAt?: string; venueName?: string } | undefined
      return {
        ok: false,
        title: 'Vé của suất khác',
        lines: schedule?.startAt ? [`Suất đúng: ${formatDateTime(schedule.startAt)}`, schedule.venueName ?? ''].filter(Boolean) : [],
      }
    }
    case 'CHECKIN_NOT_OPEN':
      return { ok: false, title: 'Chưa đến giờ check-in', lines: d.opensAt ? [`Mở cổng lúc ${formatDateTime(String(d.opensAt))}`] : [] }
    case 'CHECKIN_CLOSED':
      return { ok: false, title: 'Đã hết giờ check-in', lines: ['Suất diễn đã kết thúc.'] }
    case 'TICKET_NOT_VALID':
      return { ok: false, title: 'Vé không còn hiệu lực', lines: [d.status === 'REFUNDED' ? 'Vé đã được hoàn tiền.' : 'Vé đã bị hủy.'] }
    case 'QR_INVALID':
      return { ok: false, title: 'Mã QR không hợp lệ', lines: ['Không phải vé của hệ thống, hoặc mã đã được cấp lại.'] }
    // The schedule on screen is one I scan for, so the TICKET belongs to another event.
    case 'FORBIDDEN':
      return { ok: false, title: 'Vé không phải của sự kiện này', lines: ['Vé của một sự kiện khác. Mời khách kiểm tra lại vé.'] }
    default:
      return { ok: false, title: 'Không kiểm tra được vé', lines: [message] }
  }
}

/**
 * The camera reads the same QR many times per second: handle a code once,
 * and ignore it for `cooldownMs` afterwards (the API would refuse a second
 * entry anyway, but the gate should not flash red at a valid guest).
 */
export function createScanGate(cooldownMs = 3000) {
  let last: { code: string; at: number } | null = null
  return {
    accept(code: string, now = Date.now()): boolean {
      if (last && last.code === code && now - last.at < cooldownMs) return false
      last = { code, at: now }
      return true
    },
  }
}

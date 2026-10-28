import type { QueueStatus, SystemSnapshot, SystemStatus } from '../api/system'

/**
 * Phase 23: colours and words of the system page. The red lines are the
 * alert thresholds of the API (backend constants MONITORING.THRESHOLDS);
 * amber is "half-way there", to notice before an email goes out.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'unknown'

export const THRESHOLDS = {
  errorRatePercent: 5,
  errorRateMinRequests: 20,
  p95Ms: 2000,
  queueWaiting: 500,
  queueOldestWaitMs: 5 * 60_000,
  diskFreePercent: 10,
  /** the API reports 5001 for "slower than 5 s" */
  overMs: 5001,
}

/** The line at the top of the page. */
export function overall({ status, alerts }: SystemSnapshot): { tone: Tone; label: string } {
  if (!status.database.up) return { tone: 'bad', label: 'Cơ sở dữ liệu không trả lời' }
  if (status.worker.mode === 'bullmq' && !status.worker.alive) return { tone: 'bad', label: 'Worker không chạy: vé, email, hoàn tiền đang bị dừng' }
  if (alerts.active.length > 0) return { tone: 'warn', label: `Có ${alerts.active.length} cảnh báo` }
  if (!status.redis.up) return { tone: 'warn', label: 'Redis không trả lời: hệ thống chạy ở chế độ dự phòng' }
  return { tone: 'ok', label: 'Hoạt động bình thường' }
}

export function errorRateTone(api: SystemStatus['api']): Tone {
  if (!api) return 'unknown'
  if (api.requests < THRESHOLDS.errorRateMinRequests) return api.serverErrors > 0 ? 'warn' : 'ok'
  if (api.errorRatePercent > THRESHOLDS.errorRatePercent) return 'bad'
  return api.errorRatePercent > THRESHOLDS.errorRatePercent / 2 ? 'warn' : 'ok'
}

export function latencyTone(ms: number | null): Tone {
  if (ms === null) return 'unknown'
  if (ms > THRESHOLDS.p95Ms) return 'bad'
  return ms > THRESHOLDS.p95Ms / 2 ? 'warn' : 'ok'
}

export function diskTone(disk: SystemStatus['disk']): Tone {
  if (!disk || disk.freePercent === null) return 'unknown'
  if (disk.freePercent < THRESHOLDS.diskFreePercent) return 'bad'
  return disk.freePercent < THRESHOLDS.diskFreePercent * 2 ? 'warn' : 'ok'
}

export function queueTone(queue: QueueStatus): Tone {
  const oldest = queue.oldestWaitingMs ?? 0
  if (queue.waiting > THRESHOLDS.queueWaiting || oldest > THRESHOLDS.queueOldestWaitMs) return 'bad'
  if (queue.waiting > THRESHOLDS.queueWaiting / 2 || oldest > THRESHOLDS.queueOldestWaitMs / 2) return 'warn'
  return 'ok'
}

/** "120 ms", "1,5 giây", "> 5 giây"; "—" when unknown. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms >= THRESHOLDS.overMs) return '> 5 giây'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giây`
}

/** A duration in words: "45 giây", "12 phút", "3 giờ", "2 ngày". */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} giây`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} giờ`
  return `${Math.round(hours / 24)} ngày`
}

/** Vietnamese names of the background queues (backend src/queue/queues.js). */
export const QUEUE_LABEL: Record<string, string> = {
  tickets: 'Phát vé',
  emails: 'Email',
  holds: 'Hết hạn giữ chỗ',
  notifications: 'Thông báo',
  maintenance: 'Bảo trì định kỳ',
  payments: 'Hoàn tiền VNPay',
}

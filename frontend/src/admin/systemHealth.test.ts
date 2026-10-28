import { describe, expect, test } from 'vitest'
import type { SystemSnapshot, SystemStatus } from '../api/system'
import { diskTone, errorRateTone, formatDuration, formatMs, latencyTone, overall, queueTone } from './systemHealth'

const status = {
  api: { requests: 200, serverErrors: 0, errorRatePercent: 0 },
  database: { up: true },
  redis: { up: true },
  worker: { mode: 'bullmq', alive: true },
} as unknown as SystemStatus
const snapshot = (changes: Partial<SystemStatus> = {}, active = 0): SystemSnapshot => ({
  status: { ...status, ...changes },
  alerts: { active: Array.from({ length: active }, (_, i) => ({ key: `k${i}`, title: 'T', detail: null, since: '' })), history: [] },
})

describe('the system page', () => {
  test('the line at the top: the worst thing first', () => {
    expect(overall(snapshot())).toEqual({ tone: 'ok', label: 'Hoạt động bình thường' })
    expect(overall(snapshot({}, 2)).tone).toBe('warn')
    expect(overall(snapshot({ redis: { up: false, pingMs: null, usedMemoryMb: null } })).tone).toBe('warn')
    expect(overall(snapshot({ worker: { mode: 'bullmq', alive: false, lastSeenAt: null, ageMs: null } }, 1)).tone).toBe('bad')
    expect(overall(snapshot({ worker: { mode: 'inline', alive: true, lastSeenAt: null, ageMs: null } })).tone).toBe('ok')
    expect(overall(snapshot({ database: { up: false, pingMs: null, pool: { total: 0, idle: 0, waiting: 0 } } })).label).toBe('Cơ sở dữ liệu không trả lời')
  })

  test('colours follow the alert thresholds; amber half-way', () => {
    const api = (requests: number, serverErrors: number, errorRatePercent: number) => ({ ...status.api!, requests, serverErrors, errorRatePercent })
    expect(errorRateTone(api(200, 0, 0))).toBe('ok')
    expect(errorRateTone(api(200, 6, 3))).toBe('warn')
    expect(errorRateTone(api(200, 12, 6))).toBe('bad')
    expect(errorRateTone(api(3, 1, 33.3))).toBe('warn') // too few requests to alert
    expect(errorRateTone(null)).toBe('unknown')
    expect([latencyTone(300), latencyTone(1500), latencyTone(2500), latencyTone(null)]).toEqual(['ok', 'warn', 'bad', 'unknown'])
    expect([diskTone({ freePercent: 50, freeGb: 1, totalGb: 2 }), diskTone({ freePercent: 15, freeGb: 1, totalGb: 2 }), diskTone({ freePercent: 9, freeGb: 1, totalGb: 2 })]).toEqual(['ok', 'warn', 'bad'])
    const queue = { name: 'emails', active: 0, delayed: 0, failed: 0 }
    expect(queueTone({ ...queue, waiting: 2, oldestWaitingMs: 1000 })).toBe('ok')
    expect(queueTone({ ...queue, waiting: 300, oldestWaitingMs: 1000 })).toBe('warn')
    expect(queueTone({ ...queue, waiting: 1, oldestWaitingMs: 6 * 60_000 })).toBe('bad')
  })

  test('durations in words', () => {
    expect([formatMs(null), formatMs(120), formatMs(1500), formatMs(5001)]).toEqual(['—', '120 ms', '1,5 giây', '> 5 giây'])
    expect([formatDuration(45_000), formatDuration(12 * 60_000), formatDuration(3 * 3600_000), formatDuration(3 * 86400_000)]).toEqual([
      '45 giây',
      '12 phút',
      '3 giờ',
      '3 ngày',
    ])
  })
})

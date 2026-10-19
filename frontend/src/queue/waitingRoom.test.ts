import { describe, expect, test } from 'vitest'
import type { QueueView } from '../api/queue'
import { formatWait, mustWait, queueProgress } from './waitingRoom'

const view = (state: QueueView['state'], enabled = true): QueueView => ({
  enabled,
  state,
  turnEndsAt: null,
  place: state === 'WAITING' ? 3 : null,
  ahead: state === 'WAITING' ? 2 : null,
  estimatedWaitSeconds: null,
})

describe('purchase queue (Phase 21)', () => {
  test('the wait, in words', () => {
    expect(formatWait(null)).toBe('')
    expect(formatWait(30)).toBe('dưới 1 phút')
    expect(formatWait(300)).toBe('khoảng 5 phút')
    expect(formatWait(3600)).toBe('khoảng 1 giờ')
    expect(formatWait(4800)).toBe('khoảng 1 giờ 20 phút')
  })

  test('progress from the first place', () => {
    expect(queueProgress(21, 21)).toBe(0)
    expect(queueProgress(21, 6)).toBe(75)
    expect(queueProgress(21, 1)).toBe(95)
    expect(queueProgress(1, 1)).toBe(95)
    expect(queueProgress(null, 4)).toBe(0)
  })

  test('who waits: in the queue without a turn, and without an open order', () => {
    expect(mustWait(view('WAITING'), false)).toBe(true)
    expect(mustWait(view('NONE'), false)).toBe(true)
    expect(mustWait(view('ACTIVE'), false)).toBe(false)
    expect(mustWait(view('WAITING', false), false)).toBe(false)
    expect(mustWait(view('WAITING'), true)).toBe(false)
    expect(mustWait(undefined, false)).toBe(false)
  })
})

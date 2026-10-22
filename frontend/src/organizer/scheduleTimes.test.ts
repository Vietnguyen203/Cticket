import { describe, expect, test } from 'vitest'
import { ApiError } from '../api/errors'
import { conflictMessage, rowOf, scheduleBody, showHours } from './scheduleTimes'

const conflict = (startAt: string, endAt: string, sameEvent: boolean) =>
  new ApiError(409, 'SCHEDULE_CONFLICT', 'x', [{ field: 'body.startAt', message: 'overlaps', conflict: { startAt, endAt, sameEvent } }])

describe('a schedule in the way is named', () => {
  test('a show of this event: its times, and a hint when it looks mistyped (26 hours)', () => {
    const message = conflictMessage(conflict('2026-10-24T15:00:00Z', '2026-10-25T16:55:00Z', true))
    expect(message).toMatch(/^Trùng giờ với một suất khác của sự kiện này \(/)
    expect(message).toMatch(/kéo dài 25\.9 giờ/)
    expect(message).toMatch(/bấm "Lưu"/)
  })

  test('a normal show of this event: no hint', () => {
    expect(conflictMessage(conflict('2026-10-24T12:00:00Z', '2026-10-24T15:00:00Z', true))).not.toMatch(/kéo dài/)
  })

  test("another organizer's show: only its times", () => {
    expect(conflictMessage(conflict('2026-10-24T12:00:00Z', '2026-10-24T15:00:00Z', false))).toMatch(/suất của một sự kiện khác lúc/)
  })

  test('other errors, or an old API without the details: null (the generic message stays)', () => {
    expect(conflictMessage(new ApiError(409, 'SCHEDULE_CONFLICT', 'x'))).toBeNull()
    expect(conflictMessage(new ApiError(422, 'VENUE_NOT_AVAILABLE', 'x', [{ conflict: {} }]))).toBeNull()
  })
})

test('showHours', () => {
  expect(showHours('2026-10-24T15:00:00Z', '2026-10-24T18:00:00Z')).toBe(3)
  expect(showHours('2026-10-24T15:00:00Z', '2026-10-25T16:55:00Z')).toBe(25.9)
})

describe('a line of the schedule list', () => {
  // 22:00 on 24/10 → 23:55 on 25/10 Vietnam time (the 26-hour show of the dev data); sales close at the start.
  const saved = {
    startAt: '2026-10-24T15:00:00.000Z',
    endAt: '2026-10-25T16:55:00.000Z',
    salesStartAt: '2026-10-20T03:00:00.000Z',
    salesEndAt: '2026-10-24T15:00:00.000Z',
  }

  test('a saved show reads as one date and two times', () => {
    expect(rowOf(saved)).toMatchObject({ date: '2026-10-24', start: '22:00', end: '23:55' })
  })

  test('saving the line as it reads fixes the 26-hour show: it ends the same evening', () => {
    expect(scheduleBody(rowOf(saved), saved)).toEqual({ endAt: '2026-10-24T16:55:00.000Z' })
  })

  test('moving the start moves the default sales end with it; a custom sales end stays', () => {
    const moved = { ...rowOf(saved), start: '20:00', end: '22:00' }
    expect(scheduleBody(moved, saved)).toEqual({
      startAt: '2026-10-24T13:00:00.000Z',
      endAt: '2026-10-24T15:00:00.000Z',
      salesEndAt: '2026-10-24T13:00:00.000Z',
    })
    const custom = { ...saved, salesEndAt: '2026-10-23T03:00:00.000Z' }
    expect(scheduleBody({ ...rowOf(custom), start: '20:00', end: '22:00' }, custom)).not.toHaveProperty('salesEndAt')
  })

  test('a new line: times (and a custom sales window if given); incomplete: null', () => {
    expect(scheduleBody({ date: '2026-11-20', start: '19:30', end: '', salesStartAt: '', salesEndAt: '' })).toEqual({
      startAt: '2026-11-20T12:30:00.000Z',
      endAt: '2026-11-20T15:30:00.000Z',
    })
    expect(scheduleBody({ date: '2026-11-20', start: '', end: '', salesStartAt: '', salesEndAt: '' })).toBeNull()
  })
})

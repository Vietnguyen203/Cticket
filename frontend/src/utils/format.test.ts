import { describe, expect, test } from 'vitest'
import { dateParts } from './format'

describe('dateParts (UI redesign: the date block of event cards)', () => {
  test('Vietnam time, whatever the device’s time zone', () => {
    // 12:30 UTC = 19:30 in Vietnam, Tuesday 20 October 2026
    expect(dateParts('2026-10-20T12:30:00Z')).toEqual({ day: '20', month: 'Th10', weekday: 'Thứ Ba', time: '19:30', year: '2026' })
  })

  test('the day changes at midnight Vietnam time, not UTC', () => {
    // 18:00 UTC on the 1st = 01:00 on the 2nd in Vietnam
    expect(dateParts('2026-03-01T18:00:00Z')).toMatchObject({ day: '2', month: 'Th3', time: '01:00' })
  })
})

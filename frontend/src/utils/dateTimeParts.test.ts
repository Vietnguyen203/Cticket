import { describe, expect, test } from 'vitest'
import { formatTimeInput, parseTime24, partlyFilled, showTimes, timeProblem } from './dateTimeParts'

describe('24-hour time typed as HH:mm', () => {
  test('valid times, with or without the colon', () => {
    expect(parseTime24('19:30')).toBe('19:30')
    expect(parseTime24('1930')).toBe('19:30')
    expect(parseTime24('9:30')).toBe('09:30')
    expect(parseTime24('930')).toBe('09:30')
    expect(parseTime24('00:00')).toBe('00:00')
    expect(parseTime24('23:59')).toBe('23:59')
  })

  test('not a 24-hour time', () => {
    for (const bad of ['24:00', '19:60', '7pm', '19', '', '12:5', '123:45']) expect(parseTime24(bad)).toBeNull()
  })

  test('the box adds the colon while typing, digits only', () => {
    expect(formatTimeInput('1')).toBe('1')
    expect(formatTimeInput('19')).toBe('19')
    expect(formatTimeInput('193')).toBe('19:3')
    expect(formatTimeInput('19305')).toBe('19:30')
    expect(formatTimeInput('19h30')).toBe('19:30')
    expect(formatTimeInput('9:3')).toBe('09:3')
  })

  test('says what is wrong: at once when impossible, otherwise when the box is left', () => {
    expect(timeProblem('25', false)).toMatch(/24 giờ/)
    expect(timeProblem('19:7', false)).toMatch(/24 giờ/)
    expect(timeProblem('19:', false)).toBe('')
    expect(timeProblem('19:', true)).toMatch(/24 giờ/)
    expect(timeProblem('19:30', true)).toBe('')
    expect(timeProblem('', true)).toBe('')
  })
})

test('partlyFilled: a date without a time, or a time without a date', () => {
  expect(partlyFilled({ date: '', time: '' })).toBe(false)
  expect(partlyFilled({ date: '2026-11-20', time: '' })).toBe(true)
  expect(partlyFilled({ date: '', time: '19:30' })).toBe(true)
  expect(partlyFilled({ date: '2026-11-20', time: '19:30' })).toBe(false)
})

describe('showTimes: one date, typed start / end', () => {
  test('same evening', () => {
    expect(showTimes('2026-11-20', '19:30', '22:00')).toEqual({ startAt: '2026-11-20T19:30', endAt: '2026-11-20T22:00' })
  })
  test('no end: three hours later, across midnight if need be', () => {
    expect(showTimes('2026-11-20', '1930', '')).toEqual({ startAt: '2026-11-20T19:30', endAt: '2026-11-20T22:30' })
    expect(showTimes('2026-12-31', '22:00', '')).toEqual({ startAt: '2026-12-31T22:00', endAt: '2027-01-01T01:00' })
  })
  test('an end earlier than the start is after midnight', () => {
    expect(showTimes('2026-11-20', '21:00', '01:30')).toEqual({ startAt: '2026-11-20T21:00', endAt: '2026-11-21T01:30' })
  })
  test('missing date / start, or an invalid end: not usable yet', () => {
    expect(showTimes('', '19:00', '')).toEqual({ startAt: '', endAt: '' })
    expect(showTimes('2026-11-20', '25:00', '')).toEqual({ startAt: '', endAt: '' })
    expect(showTimes('2026-11-20', '19:00', '24:10')).toEqual({ startAt: '2026-11-20T19:00', endAt: '' })
  })
})

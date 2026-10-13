import { describe, expect, test } from 'vitest'
import { fromVnInput, toVnInput } from './vnTime'

describe('Vietnam time in forms', () => {
  test('an instant is shown as Vietnam wall-clock time (UTC+7)', () => {
    expect(toVnInput('2026-11-02T12:00:00.000Z')).toBe('2026-11-02T19:00')
    expect(toVnInput('2026-11-02T20:30:00.000Z')).toBe('2026-11-03T03:30') // next day in Vietnam
    expect(toVnInput(null)).toBe('')
  })

  test('what is typed is read as Vietnam time, whatever the computer time zone', () => {
    expect(fromVnInput('2026-11-02T19:00')).toBe('2026-11-02T12:00:00.000Z')
    expect(fromVnInput('2026-11-03T03:30')).toBe('2026-11-02T20:30:00.000Z')
    expect(fromVnInput('')).toBeUndefined()
    expect(fromVnInput('2026-13-40T99:00')).toBeUndefined()
  })

  test('round trip', () => {
    const iso = '2027-01-31T17:45:00.000Z'
    expect(fromVnInput(toVnInput(iso))).toBe(iso)
  })
})

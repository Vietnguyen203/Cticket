import { describe, expect, test } from 'vitest'
import { caretAfterDigits, groupDigits, onlyDigits } from './digits'

describe('numbers typed with "." between thousands', () => {
  test('grouped by 3 from the right', () => {
    expect(groupDigits('')).toBe('')
    expect(groupDigits('999')).toBe('999')
    expect(groupDigits('1000')).toBe('1.000')
    expect(groupDigits('15000')).toBe('15.000')
    expect(groupDigits('1500000')).toBe('1.500.000')
  })

  test('typed or pasted text gives back the bare digits', () => {
    expect(onlyDigits('1.500.000')).toBe('1500000')
    expect(onlyDigits('1.500.000 ₫')).toBe('1500000')
    expect(onlyDigits('abc')).toBe('')
    expect(onlyDigits('007')).toBe('7')
    expect(onlyDigits('0')).toBe('0')
  })

  test('the caret stays after the same digit when dots come and go', () => {
    // "1500|" + "0" typed → "15.000": caret after the 5th digit, at the end.
    expect(caretAfterDigits('15.000', 5)).toBe(6)
    // "1|.500.000" → after the first digit, before the dot.
    expect(caretAfterDigits('1.500.000', 1)).toBe(1)
    expect(caretAfterDigits('1.500.000', 2)).toBe(3)
    expect(caretAfterDigits('1.500', 0)).toBe(0)
  })
})

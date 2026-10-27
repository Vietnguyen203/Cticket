import { describe, expect, test } from 'vitest'
import { CHOICE_LABEL, isDark, NEXT_CHOICE } from './theme'

describe('the light / dark theme', () => {
  test('"system" follows the device; light and dark do not', () => {
    expect(isDark('system', true)).toBe(true)
    expect(isDark('system', false)).toBe(false)
    expect(isDark('dark', false)).toBe(true)
    expect(isDark('light', true)).toBe(false)
  })

  test('the button cycles through the three choices', () => {
    expect([NEXT_CHOICE.light, NEXT_CHOICE.dark, NEXT_CHOICE.system]).toEqual(['dark', 'system', 'light'])
    expect(CHOICE_LABEL.system).toBe('Theo máy')
  })
})

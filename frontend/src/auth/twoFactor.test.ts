import { describe, expect, test } from 'vitest'
import { groupSecret, normalizeCode, recoveryCodesFile } from './twoFactor'

describe('two-factor helpers', () => {
  test('a code as typed or pasted becomes 6 digits', () => {
    expect(normalizeCode('123 456')).toBe('123456')
    expect(normalizeCode('123-456')).toBe('123456')
    expect(normalizeCode(' 12a3456789')).toBe('123456')
    expect(normalizeCode('12')).toBe('12')
  })

  test('the setup key in groups of 4', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP')
    expect(groupSecret('ABCDEF')).toBe('ABCD EF')
  })

  test('the recovery codes file: account, then one code per line', () => {
    const text = recoveryCodesFile(['ABCDE-FGH23', 'JKLMN-PQR45'], 'lan@example.com', new Date('2026-10-14T03:00:00Z'))
    const lines = text.split('\r\n')
    expect(lines[1]).toBe('Tài khoản: lan@example.com')
    expect(lines).toContain('ABCDE-FGH23')
    expect(lines.indexOf('JKLMN-PQR45')).toBe(lines.indexOf('ABCDE-FGH23') + 1)
  })
})

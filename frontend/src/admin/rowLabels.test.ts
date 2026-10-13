import { describe, expect, test } from 'vitest'
import { parseRowLabels } from './rowLabels'

describe('parseRowLabels', () => {
  test('ranges and single rows, case-insensitive, without duplicates', () => {
    expect(parseRowLabels('a-c, F')).toEqual(['A', 'B', 'C', 'F'])
    expect(parseRowLabels('1-3')).toEqual(['1', '2', '3'])
    expect(parseRowLabels('VIP1, A, A')).toEqual(['VIP1', 'A'])
  })

  test('invalid input is refused', () => {
    expect(parseRowLabels('')).toBeNull()
    expect(parseRowLabels('C-A')).toBeNull()
    expect(parseRowLabels('A-3')).toBeNull()
    expect(parseRowLabels('TOOLONG')).toBeNull()
    expect(parseRowLabels('A-B-C')).toBeNull()
  })
})

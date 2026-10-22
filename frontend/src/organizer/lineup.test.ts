import { describe, expect, test } from 'vitest'
import { newRow, sameLineup, toLineup } from './lineup'

const row = (artist: string) => ({ ...newRow(), artist })

describe('the guest artists of an event', () => {
  test('names only, in the order entered, trimmed; empty lines and repeats left out', () => {
    expect(toLineup([row(' Hà Anh Tuấn '), row(''), row('Phương  Linh'), row('hà anh tuấn')])).toEqual([
      { artist: 'Hà Anh Tuấn', time: null, note: null },
      { artist: 'Phương Linh', time: null, note: null },
    ])
  })

  test('sameLineup compares the names only (older items may carry a time)', () => {
    expect(sameLineup(toLineup([row('A')]), [{ artist: 'A', time: '19:00', note: 'x' }])).toBe(true)
    expect(sameLineup(toLineup([row('A'), row('B')]), [{ artist: 'B', time: null, note: null }, { artist: 'A', time: null, note: null }])).toBe(false)
  })
})

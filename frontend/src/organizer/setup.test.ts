import { describe, expect, test } from 'vitest'
import type { LayoutZone } from '../api/admin'
import { assignmentsOf, MIXED, rowChoicesOf, rowKey } from './setup'

const seat = (zoneId: string, rowLabel: string, n: number) => ({ id: `${rowLabel}${n}`, zoneId, code: `${rowLabel}${n}`, rowLabel, seatNumber: n, seatType: 'STANDARD' })
const zones: LayoutZone[] = [
  { id: 'zA', code: 'A', name: 'Khu A', kind: 'SEATED', capacity: null, seats: ['A', 'B', 'C'].flatMap((r) => [1, 2].map((n) => seat('zA', r, n))) },
  { id: 'pit', code: 'PIT', name: 'Đứng', kind: 'STANDING', capacity: 50, seats: [] },
]

describe('seat plan by rows', () => {
  test('reads the current plan as one choice per row (MIXED when a row has several types)', () => {
    const plan = { totalAssignedSeats: 3, assignments: [{ seatId: 'A1', ticketTypeId: 'vip' }, { seatId: 'A2', ticketTypeId: 'vip' }, { seatId: 'B1', ticketTypeId: 'std' }] }
    expect(rowChoicesOf(zones, plan)).toEqual({ [rowKey('zA', 'A')]: 'vip', [rowKey('zA', 'B')]: MIXED, [rowKey('zA', 'C')]: '' })
  })

  test('turns choices into row assignments; MIXED rows keep their seats; unsold rows are left out', () => {
    const plan = { totalAssignedSeats: 1, assignments: [{ seatId: 'B1', ticketTypeId: 'std' }] }
    const choices = { [rowKey('zA', 'A')]: 'vip', [rowKey('zA', 'B')]: MIXED, [rowKey('zA', 'C')]: 'vip' }
    expect(assignmentsOf(zones, plan, choices)).toEqual([
      { ticketTypeId: 'vip', zoneId: 'zA', rows: ['A', 'C'] },
      { ticketTypeId: 'std', seatIds: ['B1'] },
    ])
  })
})

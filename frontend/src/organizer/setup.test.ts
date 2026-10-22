import { describe, expect, test } from 'vitest'
import type { LayoutZone, ScheduleTicketType } from '../api/admin'
import { assignmentsOf, layoutSignature, MIXED, rowChoicesOf, rowKey, seatedSeatCount, venueGaps, venueUsable } from './setup'

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

describe('what a venue can sell (a schedule there must not be a dead end)', () => {
  const seatedNoSeats: LayoutZone = { id: 'vip', code: 'VIP', name: 'Vip', kind: 'SEATED', capacity: null, seats: [] }

  test('a seated zone counts once its seats are generated; a standing zone right away', () => {
    expect(seatedSeatCount(zones)).toBe(6)
    expect(venueUsable(zones)).toBe(true)
    expect(seatedSeatCount([seatedNoSeats])).toBe(0)
    expect(venueUsable([seatedNoSeats])).toBe(false) // the "Vip zone, 0 seats" venue found in the dev data
    expect(venueUsable([])).toBe(false)
    expect(venueUsable([seatedNoSeats, zones[1]])).toBe(true)
  })

  test('layoutSignature changes when seats or standing zones are added, not otherwise', () => {
    const before = layoutSignature([seatedNoSeats])
    expect(layoutSignature([{ ...seatedNoSeats, name: 'VIP mới' }])).toBe(before)
    expect(layoutSignature([{ ...seatedNoSeats, seats: [seat('vip', 'A', 1)] }])).not.toBe(before)
    expect(layoutSignature([seatedNoSeats, zones[1]])).not.toBe(before)
  })
})

describe('venueGaps: what the venue cannot sell yet, said on the schedule', () => {
  const seatedNoSeats: LayoutZone = { id: 'vip', code: 'VIP', name: 'Vip', kind: 'SEATED', capacity: null, seats: [] }
  const vip: ScheduleTicketType = { id: 'v', code: 'VIP', name: 'Hạng VIP', price: 1, inventoryMode: 'RESERVED', capacity: null, maxPerOrder: 10, status: 'ACTIVE' }

  test('seats and a standing zone: nothing to say', () => {
    expect(venueGaps('Nhà hát', zones, [vip])).toBeNull()
  })

  test('no seats and no standing zone: nothing can be sold (blocking)', () => {
    expect(venueGaps('Sân', [seatedNoSeats], [])).toEqual({ blocking: true, message: expect.stringMatching(/chưa có ghế nào và chưa có khu đứng/) })
  })

  test('no seats: blocking only if a seated ticket type waits for seats', () => {
    expect(venueGaps('Sân', [seatedNoSeats, zones[1]], [vip])).toEqual({ blocking: true, message: expect.stringMatching(/hạng ghế ngồi "Hạng VIP" không gán ghế được/) })
    expect(venueGaps('Sân', [seatedNoSeats, zones[1]], [])).toEqual({ blocking: false, message: expect.stringMatching(/chỉ bán được vé đứng/) })
  })

  test('no standing zone: standing tickets cannot be added (they need a zone)', () => {
    expect(venueGaps('Nhà hát', [zones[0]], [vip])).toEqual({ blocking: false, message: expect.stringMatching(/chưa có khu đứng: suất này chỉ bán được vé ghế ngồi/) })
  })
})

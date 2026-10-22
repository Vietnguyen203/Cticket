import { describe, expect, test } from 'vitest'
import type { LayoutZone, ScheduleTicketType } from '../api/admin'
import { allocation, freeSeats, planWith, seatRangeLabel, takeSeats } from './allocation'

const seat = (zoneId: string, rowLabel: string, n: number) => ({ id: `${zoneId}-${rowLabel}${n}`, zoneId, code: `${rowLabel}${n}`, rowLabel, seatNumber: n, seatType: 'STANDARD' })
const rows = (zoneId: string, labels: string[], perRow: number) => labels.flatMap((r) => Array.from({ length: perRow }, (_, i) => seat(zoneId, r, i + 1)))
// Seats listed out of order on purpose: tiers still take them front rows first.
const zones: LayoutZone[] = [
  { id: 'A', code: 'A', name: 'Khu A', kind: 'SEATED', capacity: null, seats: [...rows('A', ['B', 'A'], 5)].reverse() },
  { id: 'P', code: 'P', name: 'Sàn', kind: 'STANDING', capacity: 100, seats: [] },
  { id: 'B', code: 'B', name: 'Khu B', kind: 'SEATED', capacity: null, seats: rows('B', ['C', 'D'], 5) },
]
const empty = { totalAssignedSeats: 0, assignments: [] }

describe('seated tiers take the next free seats, front rows first', () => {
  test('VIP 7 seats: row A of zone A, then the start of row B', () => {
    const vip = takeSeats(zones, empty, 7)!
    expect(vip).toEqual(['A-A1', 'A-A2', 'A-A3', 'A-A4', 'A-A5', 'A-B1', 'A-B2'])
    expect(seatRangeLabel(zones, vip)).toBe('Khu A: hàng A–B')
  })

  test('the next tier continues where the previous stopped, into the next zone', () => {
    const plan = { totalAssignedSeats: 7, assignments: takeSeats(zones, empty, 7)!.map((seatId) => ({ seatId, ticketTypeId: 'vip' })) }
    const regular = takeSeats(zones, plan, 6)!
    expect(regular).toEqual(['A-B3', 'A-B4', 'A-B5', 'B-C1', 'B-C2', 'B-C3'])
    expect(seatRangeLabel(zones, regular)).toBe('Khu A: hàng B; Khu B: hàng C')
    expect(freeSeats(zones, plan)).toHaveLength(13)
  })

  test('not enough seats left: null (the tier is not created)', () => {
    expect(takeSeats(zones, empty, 21)).toBeNull()
    expect(takeSeats(zones, empty, 0)).toBeNull()
  })

  test('the plan sent keeps the other tiers and adds the new one', () => {
    const plan = { totalAssignedSeats: 2, assignments: [{ seatId: 'A-A1', ticketTypeId: 'vip' }, { seatId: 'A-A2', ticketTypeId: 'vip' }] }
    expect(planWith(plan, 'std', ['A-A3'])).toEqual([
      { ticketTypeId: 'vip', seatIds: ['A-A1', 'A-A2'] },
      { ticketTypeId: 'std', seatIds: ['A-A3'] },
    ])
  })
})

test('allocation: seated seats + standing tickets against the total', () => {
  const tt = (id: string, inventoryMode: ScheduleTicketType['inventoryMode'], capacity: number | null, status = 'ACTIVE'): ScheduleTicketType => ({
    id, code: id, name: id, price: 1, inventoryMode, capacity, maxPerOrder: 10, status,
  })
  const types = [tt('vip', 'RESERVED', null), tt('ga', 'GENERAL_ADMISSION', 750), tt('old', 'GENERAL_ADMISSION', 99, 'INACTIVE')]
  expect(allocation(1000, types, { vip: 50 })).toEqual({ seated: 50, standing: 750, allocated: 800, remaining: 200 })
  expect(allocation(null, types, { vip: 50 }).remaining).toBeNull()
})

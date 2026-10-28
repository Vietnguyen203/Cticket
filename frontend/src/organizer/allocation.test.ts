import { describe, expect, test } from 'vitest'
import type { LayoutZone, ScheduleTicketType } from '../api/admin'
import { allocation, freeSeats, freeSeatsOfZones, planWith, planWithAll, planWithout, seatRangeLabel, tierCode, tierRows, zoneLines } from './allocation'

const seat = (zoneId: string, rowLabel: string, n: number) => ({ id: `${zoneId}-${rowLabel}${n}`, zoneId, code: `${rowLabel}${n}`, rowLabel, seatNumber: n, seatType: 'STANDARD' })
const rows = (zoneId: string, labels: string[], perRow: number) => labels.flatMap((r) => Array.from({ length: perRow }, (_, i) => seat(zoneId, r, i + 1)))
// Seats listed out of order on purpose: tiers still take them front rows first.
const zones: LayoutZone[] = [
  { id: 'A', code: 'A', name: 'Khu A', kind: 'SEATED', capacity: null, seats: [...rows('A', ['B', 'A'], 5)].reverse() },
  { id: 'P', code: 'P', name: 'Sàn', kind: 'STANDING', capacity: 100, seats: [] },
  { id: 'B', code: 'B', name: 'Khu B', kind: 'SEATED', capacity: null, seats: rows('B', ['C', 'D'], 5) },
]
const empty = { totalAssignedSeats: 0, assignments: [] }

describe('seats in order, front rows first', () => {
  test('free seats: zone order, then row, then seat number (whatever the listing order)', () => {
    expect(freeSeats(zones, empty).map((s) => s.id).slice(0, 7)).toEqual(['A-A1', 'A-A2', 'A-A3', 'A-A4', 'A-A5', 'A-B1', 'A-B2'])
  })

  test('the range of a tier: rows per zone', () => {
    expect(seatRangeLabel(zones, ['A-A1', 'A-B5'])).toBe('Khu A: hàng A–B')
    expect(seatRangeLabel(zones, ['A-B3', 'B-C1'])).toBe('Khu A: hàng B; Khu B: hàng C')
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
  // A paused seated tier keeps its seats in the plan, and the API counts them: so does the page.
  const paused = [tt('vip', 'RESERVED', null), tt('old-vip', 'RESERVED', null, 'INACTIVE'), tt('ga', 'GENERAL_ADMISSION', 60)]
  expect(allocation(100, paused, { vip: 10, 'old-vip': 30 })).toEqual({ seated: 40, standing: 60, allocated: 100, remaining: 0 })
})

test('planWithout: one zone taken off a tier; the tier keeps its other seats, the other tiers stay', () => {
  const plan = {
    totalAssignedSeats: 4,
    assignments: [
      { seatId: 'A-A1', ticketTypeId: 'vip' },
      { seatId: 'B-C1', ticketTypeId: 'vip' },
      { seatId: 'B-C2', ticketTypeId: 'vip' },
      { seatId: 'A-A2', ticketTypeId: 'std' },
    ],
  }
  expect(planWithout(plan, 'vip', ['B-C1', 'B-C2', 'B-C3'])).toEqual([
    { ticketTypeId: 'vip', seatIds: ['A-A1'] },
    { ticketTypeId: 'std', seatIds: ['A-A2'] },
  ])
  expect(planWithout(plan, 'std', ['A-A2'])).toEqual([{ ticketTypeId: 'vip', seatIds: ['A-A1', 'B-C1', 'B-C2'] }])
})

test('freeSeatsOfZones: every free seat of the zone, front rows first (a partly taken zone gives what is left)', () => {
  expect(freeSeatsOfZones(zones, empty, ['B'])).toEqual(['B-C1', 'B-C2', 'B-C3', 'B-C4', 'B-C5', 'B-D1', 'B-D2', 'B-D3', 'B-D4', 'B-D5'])
  const plan = { totalAssignedSeats: 5, assignments: ['A-A1', 'A-A2', 'A-A3', 'A-A4', 'A-A5'].map((seatId) => ({ seatId, ticketTypeId: 'vip' })) }
  expect(freeSeatsOfZones(zones, plan, ['A'])).toEqual(['A-B1', 'A-B2', 'A-B3', 'A-B4', 'A-B5'])
})

describe('tiers given to the zones the venue already has', () => {
  const tt = (id: string, inventoryMode: 'RESERVED' | 'GENERAL_ADMISSION', extra: Partial<ScheduleTicketType> = {}): ScheduleTicketType => ({
    id, code: id, name: `Hạng ${id}`, price: 100, inventoryMode, capacity: null, maxPerOrder: 10, status: 'ACTIVE', ...extra,
  })

  test('a line per zone: seated zones with their seats, standing zones with their capacity, and their tiers', () => {
    const plan = { totalAssignedSeats: 10, assignments: rows('A', ['A', 'B'], 5).map((s) => ({ seatId: s.id, ticketTypeId: 'vip' })) }
    const lines = zoneLines(zones, plan, [tt('vip', 'RESERVED'), tt('ga', 'GENERAL_ADMISSION', { capacity: 60, venueZoneId: 'P' })])
    expect(lines.map((l) => [l.zone.id, l.seated, l.places, l.free, l.tiers.map((t) => `${t.id}:${t.places}`)])).toEqual([
      ['A', true, 10, 0, ['vip:10']],
      ['P', false, 100, 40, ['ga:60']],
      ['B', true, 10, 10, []],
    ])
  })

  test('tierCode: from the zone code, unique in the show', () => {
    expect(tierCode('VIP', [])).toBe('VIP')
    expect(tierCode('Khu đặc biệt', [])).toBe('KHUDACBIET')
    expect(tierCode('A', ['a', 'A-2'])).toBe('A-3')
  })
})

describe('one "Xác nhận" for every zone with a price', () => {
  const lines = zoneLines(zones, empty, [])
  const draft = (price: string, typed: string | null = null, name?: string) => ({ name: name ?? 'Hạng', price, typed, maxPerOrder: '' })

  test('counts not typed share what is left of the total, zone after zone', () => {
    const { rows, chosen, overTotal } = tierRows(lines, {}, 25)
    expect(rows.map((r) => [r.line.zone.id, r.count])).toEqual([
      ['A', '10'],
      ['P', '15'],
      ['B', '0'],
    ])
    expect(chosen).toEqual([]) // no price yet: nothing to assign
    expect(overTotal).toBeNull()
  })

  test('only the zones with a price are assigned; each checked, and together within the total', () => {
    const ok = tierRows(lines, { A: draft('1000000'), P: draft('300000', '15') }, 25)
    expect(ok.chosen.map((r) => [r.line.zone.id, r.places, r.problem])).toEqual([
      ['A', 10, null],
      ['P', 15, null],
    ])
    expect(ok.overTotal).toBeNull()

    const over = tierRows(lines, { A: draft('1000000'), P: draft('300000', '20') }, 25)
    expect(over.overTotal).toContain('cộng lại 30 người, chỉ còn 25')
    expect(tierRows(lines, { A: draft('1', '11') }, 99).chosen[0].problem).toBe('Khu còn 10 ghế trống.')
    expect(tierRows(lines, { P: draft('1', '0') }, 99).chosen[0].problem).toBe('Nhập số vé (số nguyên dương).')
    expect(tierRows(lines, { A: draft('1', null, '  ') }, 99).chosen[0].problem).toBe('Nhập tên hạng.')
  })

  test('the seats of several tiers go in one seat plan, the others kept', () => {
    const plan = { totalAssignedSeats: 1, assignments: [{ seatId: 'A-A1', ticketTypeId: 'vip' }] }
    expect(planWithAll(plan, [{ ticketTypeId: 'a', seatIds: ['A-A2'] }, { ticketTypeId: 'b', seatIds: ['B-C1', 'B-C2'] }])).toEqual([
      { ticketTypeId: 'vip', seatIds: ['A-A1'] },
      { ticketTypeId: 'a', seatIds: ['A-A2'] },
      { ticketTypeId: 'b', seatIds: ['B-C1', 'B-C2'] },
    ])
  })
})

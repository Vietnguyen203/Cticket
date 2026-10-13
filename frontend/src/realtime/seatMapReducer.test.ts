import { describe, expect, test } from 'vitest'
import type { SeatMap, SeatStatus } from '../api/types'
import { initialSeatMapState, MAX_TICKETS_PER_ORDER, seatMapReducer, selectionSummary, type SeatMapAction, type SeatMapState } from './seatMapReducer'

const VIP = 'tt-vip'
const GA = 'tt-ga'

/** Row A: 10 VIP seats (2.000.000đ, max 4 per order); a standing zone with 50 GA tickets (500.000đ). */
function seatMap(statuses: Record<string, [SeatStatus, number]> = {}): SeatMap {
  const seats = Array.from({ length: 10 }, (_, i) => {
    const code = `A${String(i + 1).padStart(2, '0')}`
    const [status, version] = statuses[code] ?? ['AVAILABLE', 1]
    return { seatId: code, code, rowLabel: 'A', seatNumber: i + 1, seatType: 'STANDARD', ticketTypeId: VIP, price: 2_000_000, status, version }
  })
  const ticketType = (id: string, name: string, mode: 'RESERVED' | 'GENERAL_ADMISSION', price: number, maxPerOrder: number, available: number) => ({
    id, code: name, name, description: null, price, currency: 'VND', inventoryMode: mode, status: 'ACTIVE', maxPerOrder,
    venueZoneId: null, total: available, available,
  })
  return {
    scheduleId: 'sch-1',
    ticketTypes: [ticketType(VIP, 'VIP', 'RESERVED', 2_000_000, 4, 10), ticketType(GA, 'Vé đứng', 'GENERAL_ADMISSION', 500_000, 10, 50)],
    zones: [
      { id: 'z-a', code: 'A', name: 'Khu A', kind: 'SEATED', capacity: null, seats, generalAdmission: [] },
      { id: 'z-pit', code: 'PIT', name: 'Khu đứng', kind: 'STANDING', capacity: 50, seats: [], generalAdmission: [] },
    ],
  }
}

const run = (actions: SeatMapAction[], from: SeatMapState = initialSeatMapState) => actions.reduce(seatMapReducer, from)
const held = (seatId: string, version: number): SeatMapAction => ({
  type: 'live',
  message: { type: 'SEAT_HELD', scheduleId: 'sch-1', seats: [{ seatId, status: 'HELD', version }] },
})
const released = (seatId: string, version: number): SeatMapAction => ({
  type: 'live',
  message: { type: 'SEAT_RELEASED', scheduleId: 'sch-1', seats: [{ seatId, status: 'AVAILABLE', version }] },
})

describe('live updates', () => {
  test('a newer version is applied; a late or duplicate message changes nothing', () => {
    const state = run([{ type: 'loaded', map: seatMap() }, held('A01', 2), released('A01', 3), held('A01', 2), released('A01', 3)])
    expect(state.seats.A01).toEqual({ status: 'AVAILABLE', version: 3 })
  })

  test('updates arriving before the first load are applied on top of it (when newer)', () => {
    const state = run([held('A01', 2), held('A02', 1), { type: 'loaded', map: seatMap({ A02: ['SOLD', 5] }) }])
    expect(state.seats.A01).toEqual({ status: 'HELD', version: 2 })
    expect(state.seats.A02).toEqual({ status: 'SOLD', version: 5 }) // the REST state was fresher
    expect(state.pending).toEqual([])
  })

  test('a slower REST reload never undoes a newer live update', () => {
    const state = run([{ type: 'loaded', map: seatMap() }, held('A01', 7), { type: 'loaded', map: seatMap({ A01: ['AVAILABLE', 6] }) }])
    expect(state.seats.A01).toEqual({ status: 'HELD', version: 7 })
  })

  test('a picked seat taken by someone else is unpicked and reported', () => {
    const state = run([{ type: 'loaded', map: seatMap() }, { type: 'toggleSeat', seatId: 'A01' }, { type: 'toggleSeat', seatId: 'A02' }, held('A01', 2)])
    expect(state.selected).toEqual(['A02'])
    expect(state.taken).toEqual(['A01'])
  })

  test('while my own hold is in flight, my seats turning HELD is not news', () => {
    const state = run([{ type: 'loaded', map: seatMap() }, { type: 'toggleSeat', seatId: 'A01' }, { type: 'holdStarted' }, held('A01', 2)])
    expect(state.selected).toEqual(['A01'])
    expect(state.taken).toEqual([])
    // The hold failed after all: seats that are gone are unpicked.
    const failed = seatMapReducer(state, { type: 'holdFailed' })
    expect(failed.selected).toEqual([])
    expect(failed.taken).toEqual(['A01'])
  })

  test('standing tickets: the live count is shown and picks above it are reduced', () => {
    const state = run([
      { type: 'loaded', map: seatMap() },
      { type: 'setGaQuantity', ticketTypeId: GA, quantity: 3 },
      { type: 'live', message: { type: 'INVENTORY_UPDATED', scheduleId: 'sch-1', ticketTypes: [{ ticketTypeId: GA, available: 2 }] } },
    ])
    expect(state.gaAvailable[GA]).toBe(2)
    expect(state.gaQuantities[GA]).toBe(2)
  })
})

describe('picking', () => {
  test('only available seats can be picked; picking again unpicks', () => {
    const state = run([
      { type: 'loaded', map: seatMap({ A03: ['SOLD', 2] }) },
      { type: 'toggleSeat', seatId: 'A03' },
      { type: 'toggleSeat', seatId: 'A01' },
      { type: 'toggleSeat', seatId: 'A02' },
      { type: 'toggleSeat', seatId: 'A01' },
    ])
    expect(state.selected).toEqual(['A02'])
  })

  test("a ticket type's maxPerOrder is enforced, with a reason", () => {
    const state = run([{ type: 'loaded', map: seatMap() }, ...['A01', 'A02', 'A03', 'A04', 'A05'].map((seatId) => ({ type: 'toggleSeat', seatId }) as SeatMapAction)])
    expect(state.selected).toHaveLength(4)
    expect(state.notice).toBe('Hạng VIP: tối đa 4 vé mỗi đơn.')
  })

  test(`at most ${MAX_TICKETS_PER_ORDER} tickets per order, seats and standing tickets together`, () => {
    const state = run([
      { type: 'loaded', map: seatMap() },
      { type: 'toggleSeat', seatId: 'A01' },
      { type: 'toggleSeat', seatId: 'A02' },
      { type: 'setGaQuantity', ticketTypeId: GA, quantity: 9 },
    ])
    expect(state.gaQuantities[GA]).toBe(6)
    expect(state.notice).toBe('Mỗi đơn tối đa 8 vé.')
    expect(seatMapReducer(state, { type: 'toggleSeat', seatId: 'A03' }).selected).toHaveLength(2)
  })

  test('summary: lines and an estimated total', () => {
    const state = run([
      { type: 'loaded', map: seatMap() },
      { type: 'toggleSeat', seatId: 'A01' },
      { type: 'setGaQuantity', ticketTypeId: GA, quantity: 2 },
    ])
    expect(selectionSummary(state)).toEqual({
      lines: [
        { label: 'Khu A - A01', ticketTypeName: 'VIP', quantity: 1, amount: 2_000_000 },
        { label: 'Vé đứng', ticketTypeName: 'Vé đứng', quantity: 2, amount: 1_000_000 },
      ],
      count: 3,
      total: 3_000_000,
    })
  })
})

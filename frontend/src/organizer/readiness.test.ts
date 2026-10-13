import { describe, expect, test } from 'vitest'
import type { ScheduleTicketType } from '../api/admin'
import type { Schedule } from '../api/types'
import { submitChecklist, type ScheduleSetup } from './readiness'

const NOW = new Date('2026-10-13T00:00:00Z')

const schedule = (startAt: string, status: Schedule['status'] = 'SCHEDULED'): Schedule => ({
  id: startAt, eventId: 'e1', startAt, endAt: startAt, salesStartAt: startAt, salesEndAt: startAt, status,
  inventoryGeneratedAt: null, venue: { id: 'v1', name: 'Nhà hát', city: 'Hà Nội', addressLine: '' },
})
const ticketType = (id: string, inventoryMode: ScheduleTicketType['inventoryMode'], status = 'ACTIVE'): ScheduleTicketType => ({
  id, code: id, name: id, price: 100_000, inventoryMode, capacity: inventoryMode === 'RESERVED' ? null : 50, maxPerOrder: 10, status,
})
const setup = (overrides: Partial<ScheduleSetup>): ScheduleSetup => ({
  schedule: schedule('2026-11-02T12:00:00Z'), ticketTypes: [], seatsByTicketType: {}, unassignedSeats: 0, ...overrides,
})

describe('submitChecklist', () => {
  test('a complete event can be submitted; unassigned seats are only a warning', () => {
    const result = submitChecklist(
      [setup({ ticketTypes: [ticketType('VIP', 'RESERVED'), ticketType('GA', 'GENERAL_ADMISSION')], seatsByTicketType: { VIP: 10 }, unassignedSeats: 5 })],
      NOW,
    )
    expect(result.problems).toEqual([])
    expect(result.warnings).toHaveLength(1)
  })

  test('needs an upcoming schedule (past and cancelled ones do not count)', () => {
    const past = setup({ schedule: schedule('2026-10-01T12:00:00Z'), ticketTypes: [ticketType('GA', 'GENERAL_ADMISSION')] })
    const cancelled = setup({ schedule: schedule('2026-12-01T12:00:00Z', 'CANCELLED') })
    expect(submitChecklist([past, cancelled], NOW).problems).toEqual(['Cần ít nhất một suất diễn sắp tới.'])
    expect(submitChecklist([], NOW).problems).toEqual(['Cần ít nhất một suất diễn sắp tới.'])
  })

  test('each schedule needs an active ticket type, and seated ticket types need seats', () => {
    const { problems } = submitChecklist(
      [
        setup({ ticketTypes: [ticketType('OLD', 'GENERAL_ADMISSION', 'INACTIVE')] }),
        setup({ schedule: schedule('2026-11-03T12:00:00Z'), ticketTypes: [ticketType('VIP', 'RESERVED')] }),
      ],
      NOW,
    )
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/chưa có hạng vé/)
    expect(problems[1]).toMatch(/"VIP" chưa được gán ghế/)
  })
})

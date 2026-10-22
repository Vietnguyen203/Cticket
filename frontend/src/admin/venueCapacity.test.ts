import { describe, expect, test } from 'vitest'
import { ApiError } from '../api/errors'
import type { LayoutZone } from '../api/admin'
import { venueCapacityMessage, zonePlaces } from './venueCapacity'

const error = (detail: Record<string, number>) => new ApiError(422, 'VENUE_CAPACITY_EXCEEDED', 'x', [{ field: 'body', message: 'x', ...detail }])

describe('venue capacity: the ceiling of the zones and of a show', () => {
  test('zonePlaces: seats + standing capacity (the screenshot venue: 980 of 1000)', () => {
    const standing = (id: string, capacity: number): LayoutZone => ({ id, code: id, name: id, kind: 'STANDING', capacity, seats: [] })
    const seat = { id: 's', zoneId: 'v', code: 'A01', rowLabel: 'A', seatNumber: 1, seatType: 'STANDARD' }
    const vip: LayoutZone = { id: 'v', code: 'VIP', name: 'Vip', kind: 'SEATED', capacity: null, seats: Array.from({ length: 80 }, (_, i) => ({ ...seat, id: `s${i}` })) }
    expect(zonePlaces([standing('A', 200), standing('B', 200), standing('C', 250), standing('D', 250), vip])).toEqual({ seats: 80, standing: 900, total: 980 })
  })

  test('messages with the numbers', () => {
    expect(venueCapacityMessage(error({ capacity: 1000, used: 980, adding: 40 }))).toBe(
      'Vượt sức chứa 1.000 của địa điểm: các khu đã có 980 chỗ, chỉ còn thêm được 20.',
    )
    expect(venueCapacityMessage(error({ capacity: 900, used: 980, adding: 0 }))).toBe('Các khu đã có 980 chỗ: sức chứa không thể nhỏ hơn 980.')
    expect(venueCapacityMessage(error({ capacity: 300, used: 0, adding: 301 }))).toBe('Địa điểm chỉ chứa 300 người: không xếp được 301.')
    expect(venueCapacityMessage(new ApiError(422, 'OTHER', 'x'))).toBeNull()
  })
})

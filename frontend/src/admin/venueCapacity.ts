import type { ApiError } from '../api/errors'
import type { LayoutZone } from '../api/admin'

/** Places a venue's zones hold: its seats, plus its standing zones' capacity. */
export function zonePlaces(zones: LayoutZone[]) {
  const seats = zones.filter((z) => z.kind === 'SEATED').reduce((sum, z) => sum + z.seats.length, 0)
  const standing = zones.filter((z) => z.kind === 'STANDING').reduce((sum, z) => sum + (z.capacity ?? 0), 0)
  return { seats, standing, total: seats + standing }
}

const n = (value: number) => value.toLocaleString('vi-VN')

/**
 * VENUE_CAPACITY_EXCEEDED with its numbers: what is in the way, said with the
 * figures ("Sức chứa" is the ceiling of the zones and of a show). null for
 * any other error.
 */
export function venueCapacityMessage(error: ApiError): string | null {
  if (error.code !== 'VENUE_CAPACITY_EXCEEDED' || !Array.isArray(error.details)) return null
  const d = error.details[0] as { capacity?: number; used?: number; adding?: number } | undefined
  if (!d?.capacity) return null
  if (!d.adding) return `Các khu đã có ${n(d.used ?? 0)} chỗ: sức chứa không thể nhỏ hơn ${n(d.used ?? 0)}.`
  if (!d.used) return `Địa điểm chỉ chứa ${n(d.capacity)} người: không xếp được ${n(d.adding)}.`
  return `Vượt sức chứa ${n(d.capacity)} của địa điểm: các khu đã có ${n(d.used)} chỗ, chỉ còn thêm được ${n(Math.max(0, d.capacity - d.used))}.`
}

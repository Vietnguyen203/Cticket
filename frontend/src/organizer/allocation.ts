import type { LayoutZone, ScheduleTicketType } from '../api/admin'
import type { SeatPlanDetail } from '../api/organizer'

/**
 * Splitting a show's total attendance ("Tổng số người tham dự") into seated
 * tiers and standing tiers. A seated tier of N seats takes the venue's next N
 * free seats, front rows first (zone order, then row, then seat number):
 * the organizer gives a number, the seats follow; buyers still pick seats on
 * the map.
 */

const byRow = new Intl.Collator('vi', { numeric: true })

/** The venue's seats in the order tiers take them. */
export function orderedSeats(zones: LayoutZone[]) {
  return zones
    .filter((z) => z.kind === 'SEATED')
    .flatMap((zone) =>
      [...zone.seats]
        .sort((a, b) => byRow.compare(a.rowLabel, b.rowLabel) || a.seatNumber - b.seatNumber)
        .map((seat) => ({ ...seat, zoneId: zone.id })),
    )
}

/** Seats not in any tier yet, in order. */
export function freeSeats(zones: LayoutZone[], plan: SeatPlanDetail) {
  const taken = new Set(plan.assignments.map((a) => a.seatId))
  return orderedSeats(zones).filter((seat) => !taken.has(seat.id))
}

/** The next n free seats, or null if the venue does not have that many left. */
export function takeSeats(zones: LayoutZone[], plan: SeatPlanDetail, n: number): string[] | null {
  const free = freeSeats(zones, plan)
  return n > 0 && free.length >= n ? free.slice(0, n).map((seat) => seat.id) : null
}

/** The whole seat plan with `seatIds` added for a tier (the API replaces the plan). */
export function planWith(plan: SeatPlanDetail, ticketTypeId: string, seatIds: string[]) {
  const byType = new Map<string, string[]>()
  for (const { seatId, ticketTypeId: type } of plan.assignments) byType.set(type, [...(byType.get(type) ?? []), seatId])
  byType.set(ticketTypeId, [...(byType.get(ticketTypeId) ?? []), ...seatIds])
  return [...byType.entries()].map(([type, ids]) => ({ ticketTypeId: type, seatIds: ids }))
}

/** Where a tier's seats are: "Khu A: hàng A–E", per zone, rows in order. */
export function seatRangeLabel(zones: LayoutZone[], seatIds: string[]): string {
  const wanted = new Set(seatIds)
  const parts: string[] = []
  for (const zone of zones.filter((z) => z.kind === 'SEATED')) {
    const rows = [...new Set(zone.seats.filter((s) => wanted.has(s.id)).map((s) => s.rowLabel))].sort(byRow.compare)
    if (rows.length === 0) continue
    parts.push(`${zone.name}: hàng ${rows[0]}${rows.length > 1 ? `–${rows.at(-1)}` : ''}`)
  }
  return parts.join('; ')
}

/** How the total is split so far. remaining < 0: over the total (the API refuses it). */
export function allocation(capacity: number | null | undefined, ticketTypes: ScheduleTicketType[], seatsByTicketType: Record<string, number>) {
  const active = ticketTypes.filter((tt) => tt.status === 'ACTIVE')
  const seated = active.filter((tt) => tt.inventoryMode === 'RESERVED').reduce((sum, tt) => sum + (seatsByTicketType[tt.id] ?? 0), 0)
  const standing = active.filter((tt) => tt.inventoryMode === 'GENERAL_ADMISSION').reduce((sum, tt) => sum + (tt.capacity ?? 0), 0)
  const allocated = seated + standing
  return { seated, standing, allocated, remaining: capacity ? capacity - allocated : null }
}

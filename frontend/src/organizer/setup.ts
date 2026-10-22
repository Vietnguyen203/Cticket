import { getVenueLayout, listTicketTypes, type LayoutZone, type ScheduleTicketType } from '../api/admin'
import { toApiError } from '../api/errors'
import { getSeatPlanDetail, type SeatPlanAssignment, type SeatPlanDetail } from '../api/organizer'
import type { EventDetail, Schedule } from '../api/types'
import type { ScheduleSetup } from './readiness'

/** Everything the editor shows for one schedule. */
export interface LoadedSchedule extends ScheduleSetup {
  plan: SeatPlanDetail
  /** Zones of the venue (null: the layout could not be loaded, see layoutError) */
  zones: LayoutZone[] | null
  /** Why the layout could not be loaded: shown, never silently hiding the seat plan */
  layoutError: string | null
  /** The venue is still PENDING: the organizer who proposed it can add zones and seats */
  venuePending: boolean
  /** The venue's capacity: the ceiling of the show's total attendance (null: not set / unknown) */
  venueCapacity: number | null
}

/** Seats in the seated zones of a layout. */
export const seatedSeatCount = (zones: LayoutZone[]) =>
  zones.filter((z) => z.kind === 'SEATED').reduce((sum, z) => sum + z.seats.length, 0)

/**
 * Can a schedule sell anything at this venue? A seated zone counts only once
 * it has seats ("Sinh ghế"); a standing zone counts as soon as it exists.
 */
export const venueUsable = (zones: LayoutZone[]) => seatedSeatCount(zones) > 0 || zones.some((z) => z.kind === 'STANDING')

/**
 * What the venue of a schedule cannot sell yet, in words: seated tickets need
 * generated seats, standing tickets need a standing zone. null: nothing
 * missing. blocking: the event cannot be submitted as it is.
 */
export function venueGaps(
  venueName: string,
  zones: LayoutZone[],
  ticketTypes: ScheduleTicketType[],
): { blocking: boolean; message: string } | null {
  const noSeats = seatedSeatCount(zones) === 0
  const noStanding = !zones.some((z) => z.kind === 'STANDING')
  const seated = ticketTypes.filter((tt) => tt.inventoryMode === 'RESERVED' && tt.status === 'ACTIVE').map((tt) => `"${tt.name}"`)
  if (noSeats && noStanding) {
    return { blocking: true, message: `Địa điểm ${venueName} chưa có ghế nào và chưa có khu đứng: suất này chưa bán được vé nào.` }
  }
  if (noSeats && seated.length > 0) {
    return {
      blocking: true,
      message: `Địa điểm ${venueName} chưa có ghế nào, nên hạng ghế ngồi ${seated.join(', ')} không gán ghế được và sự kiện chưa gửi duyệt được.`,
    }
  }
  if (noSeats) return { blocking: false, message: `Địa điểm ${venueName} chưa có ghế nào: suất này chỉ bán được vé đứng.` }
  if (noStanding) {
    return { blocking: false, message: `Địa điểm ${venueName} chưa có khu đứng: suất này chỉ bán được vé ghế ngồi (vé đứng phải gắn với một khu đứng).` }
  }
  return null
}

/** What in a layout matters to the schedule editor (seats to assign, standing zones to pick). */
export const layoutSignature = (zones: LayoutZone[]) =>
  `${seatedSeatCount(zones)}:${zones.filter((z) => z.kind === 'STANDING').map((z) => z.id).join()}`

export async function loadSchedule(schedule: Schedule): Promise<LoadedSchedule> {
  let layoutError: string | null = null
  const [ticketTypes, plan, layout] = await Promise.all([
    listTicketTypes(schedule.id),
    getSeatPlanDetail(schedule.id),
    getVenueLayout(schedule.venue.id).catch((err) => {
      layoutError = toApiError(err).message
      return null
    }),
  ])
  const seatsByTicketType: Record<string, number> = {}
  for (const { ticketTypeId } of plan.assignments) seatsByTicketType[ticketTypeId] = (seatsByTicketType[ticketTypeId] ?? 0) + 1
  const seatedSeats = layout ? seatedSeatCount(layout.zones) : null
  return {
    schedule,
    ticketTypes,
    plan,
    zones: layout?.zones ?? null,
    layoutError,
    venuePending: layout?.venue.status === 'PENDING',
    venueCapacity: layout?.venue.capacity ?? null,
    seatsByTicketType,
    venueSeats: seatedSeats,
    unassignedSeats: Math.max(0, (seatedSeats ?? 0) - plan.totalAssignedSeats),
  }
}

export const loadSchedules = (event: EventDetail) => Promise.all(event.schedules.map(loadSchedule))

export const MIXED = '*'

/** One choice per row of seats: a ticket type id, '' (not sold) or MIXED (seats of several types). */
export type RowChoices = Record<string, string>

export const rowKey = (zoneId: string, rowLabel: string) => `${zoneId}|${rowLabel}`

/** The current plan as one choice per row. */
export function rowChoicesOf(zones: LayoutZone[], plan: SeatPlanDetail): RowChoices {
  const typeOfSeat = new Map(plan.assignments.map((a) => [a.seatId, a.ticketTypeId]))
  const choices: RowChoices = {}
  for (const zone of zones.filter((z) => z.kind === 'SEATED')) {
    const rows = new Map<string, Set<string>>()
    for (const seat of zone.seats) {
      const types = rows.get(seat.rowLabel) ?? new Set<string>()
      types.add(typeOfSeat.get(seat.id) ?? '')
      rows.set(seat.rowLabel, types)
    }
    for (const [rowLabel, types] of rows) choices[rowKey(zone.id, rowLabel)] = types.size === 1 ? [...types][0] : MIXED
  }
  return choices
}

/**
 * Choices → the API's assignments: whole rows grouped by ticket type and zone;
 * rows left MIXED keep their seats exactly as they are (by seat id).
 */
export function assignmentsOf(zones: LayoutZone[], plan: SeatPlanDetail, choices: RowChoices): Array<SeatPlanAssignment | { ticketTypeId: string; seatIds: string[] }> {
  const typeOfSeat = new Map(plan.assignments.map((a) => [a.seatId, a.ticketTypeId]))
  const byRows = new Map<string, SeatPlanAssignment>()
  const bySeats = new Map<string, string[]>()
  for (const zone of zones.filter((z) => z.kind === 'SEATED')) {
    const rowLabels = [...new Set(zone.seats.map((s) => s.rowLabel))]
    for (const rowLabel of rowLabels) {
      const choice = choices[rowKey(zone.id, rowLabel)] ?? ''
      if (choice === MIXED) {
        for (const seat of zone.seats.filter((s) => s.rowLabel === rowLabel)) {
          const ticketTypeId = typeOfSeat.get(seat.id)
          if (ticketTypeId) bySeats.set(ticketTypeId, [...(bySeats.get(ticketTypeId) ?? []), seat.id])
        }
      } else if (choice) {
        const key = `${choice}|${zone.id}`
        const entry = byRows.get(key) ?? { ticketTypeId: choice, zoneId: zone.id, rows: [] }
        entry.rows.push(rowLabel)
        byRows.set(key, entry)
      }
    }
  }
  return [...byRows.values(), ...[...bySeats.entries()].map(([ticketTypeId, seatIds]) => ({ ticketTypeId, seatIds }))]
}

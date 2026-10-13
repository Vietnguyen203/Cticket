import { getVenueLayout, listTicketTypes, type LayoutZone } from '../api/admin'
import { getSeatPlanDetail, type SeatPlanAssignment, type SeatPlanDetail } from '../api/organizer'
import type { EventDetail, Schedule } from '../api/types'
import type { ScheduleSetup } from './readiness'

/** Everything the editor shows for one schedule. */
export interface LoadedSchedule extends ScheduleSetup {
  plan: SeatPlanDetail
  /** Zones of the venue (null if the venue is no longer active) */
  zones: LayoutZone[] | null
}

export async function loadSchedule(schedule: Schedule): Promise<LoadedSchedule> {
  const [ticketTypes, plan, layout] = await Promise.all([
    listTicketTypes(schedule.id),
    getSeatPlanDetail(schedule.id),
    getVenueLayout(schedule.venue.id).catch(() => null),
  ])
  const seatsByTicketType: Record<string, number> = {}
  for (const { ticketTypeId } of plan.assignments) seatsByTicketType[ticketTypeId] = (seatsByTicketType[ticketTypeId] ?? 0) + 1
  const seatedSeats = layout?.zones.filter((z) => z.kind === 'SEATED').reduce((sum, z) => sum + z.seats.length, 0) ?? 0
  return {
    schedule,
    ticketTypes,
    plan,
    zones: layout?.zones ?? null,
    seatsByTicketType,
    unassignedSeats: Math.max(0, seatedSeats - plan.totalAssignedSeats),
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

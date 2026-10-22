import type { ScheduleTicketType } from '../api/admin'
import type { Schedule } from '../api/types'
import { formatDateTime } from '../utils/format'

/** What the organizer configured for one schedule (loaded by the editor). */
export interface ScheduleSetup {
  schedule: Schedule
  ticketTypes: ScheduleTicketType[]
  /** Seats assigned to each RESERVED ticket type */
  seatsByTicketType: Record<string, number>
  /** Seats of the venue's seated zones that belong to no ticket type (not sold) */
  unassignedSeats: number
  /** Seats in the venue's seated zones (null: the layout could not be loaded) */
  venueSeats?: number | null
}

/**
 * The checks the API makes when an event is submitted (events.service,
 * inventory.service: EVENT_HAS_NO_SCHEDULES, TICKET_TYPES_REQUIRED,
 * SEAT_PLAN_INCOMPLETE), done here first so the organizer sees everything
 * to fix at once. `warnings` do not block the submission.
 */
export function submitChecklist(setups: ScheduleSetup[], now = new Date()): { problems: string[]; warnings: string[] } {
  const problems: string[] = []
  const warnings: string[] = []
  const live = setups.filter((s) => s.schedule.status === 'SCHEDULED')

  if (!live.some((s) => new Date(s.schedule.startAt) > now)) problems.push('Cần ít nhất một suất diễn sắp tới.')
  for (const { schedule, ticketTypes, seatsByTicketType, unassignedSeats, venueSeats } of live) {
    const when = formatDateTime(schedule.startAt)
    const active = ticketTypes.filter((tt) => tt.status === 'ACTIVE')
    if (active.length === 0) problems.push(`Suất ${when}: chưa có hạng vé.`)
    for (const tt of active) {
      if (tt.inventoryMode === 'RESERVED' && !seatsByTicketType[tt.id]) {
        problems.push(
          venueSeats === 0
            ? `Suất ${when}: hạng "${tt.name}" là ghế ngồi nhưng địa điểm ${schedule.venue.name} chưa có ghế nào.`
            : `Suất ${when}: hạng "${tt.name}" chưa được gán ghế nào.`,
        )
      }
    }
    if (unassignedSeats > 0) warnings.push(`Suất ${when}: ${unassignedSeats} ghế chưa thuộc hạng vé nào (sẽ không bán).`)
    if (schedule.capacity) {
      const placed = active.reduce((sum, tt) => sum + (tt.inventoryMode === 'RESERVED' ? (seatsByTicketType[tt.id] ?? 0) : (tt.capacity ?? 0)), 0)
      if (placed < schedule.capacity) warnings.push(`Suất ${when}: còn ${schedule.capacity - placed} / ${schedule.capacity} người chưa xếp vào hạng nào.`)
    }
  }
  return { problems, warnings }
}

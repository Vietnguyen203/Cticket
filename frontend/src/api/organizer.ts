import type { OrganizerProfile, ScheduleTicketType } from './admin'
import { api } from './client'
import type { EventDetail, EventSummary, PageMeta, Schedule, SeatMap } from './types'

/** API calls of the organizer pages (Phase 12.2). "Own event" rules are checked by the API. */

// --- Organizer profile --------------------------------------------------------

export interface OrganizerApplication {
  organizationName: string
  description?: string | null
  taxCode?: string | null
}

/** null when the user never applied. */
export async function getMyOrganizer(): Promise<OrganizerProfile | null> {
  try {
    return (await api.get('/organizers/me')).data.data.organizer
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null
    throw err
  }
}

export async function applyAsOrganizer(input: OrganizerApplication): Promise<OrganizerProfile> {
  return (await api.post('/organizers', input)).data.data.organizer
}

// --- Events -------------------------------------------------------------------

export interface EventInput {
  title: string
  description?: string | null
  bannerUrl?: string | null
  thumbnailUrl?: string | null
  ageRestriction?: number | null
  categoryIds: string[]
}

export async function listMyEvents(params: { status?: string; page?: number; pageSize?: number }) {
  const res = await api.get('/events', { params: { mine: 'true', ...params } })
  return { events: res.data.data.events as EventSummary[], meta: res.data.meta as PageMeta }
}

export async function getMyEvent(id: string): Promise<EventDetail> {
  return (await api.get(`/events/${id}`)).data.data.event
}

export async function createEvent(input: EventInput): Promise<EventDetail> {
  return (await api.post('/events', input)).data.data.event
}

export async function updateEvent(id: string, input: Partial<EventInput>): Promise<EventDetail> {
  return (await api.patch(`/events/${id}`, input)).data.data.event
}

export async function deleteEvent(id: string): Promise<void> {
  await api.delete(`/events/${id}`)
}

/** Submit (PENDING_APPROVAL), withdraw (DRAFT) or cancel (CANCELLED + reason). */
export async function setEventStatus(id: string, status: 'PENDING_APPROVAL' | 'DRAFT' | 'CANCELLED', reason?: string) {
  return (await api.patch(`/events/${id}/status`, { status, ...(reason ? { reason } : {}) })).data.data.event as EventDetail
}

// --- Schedules ----------------------------------------------------------------

export interface ScheduleInput {
  venueId: string
  startAt: string
  endAt: string
  salesStartAt?: string
  salesEndAt?: string
}

export async function createSchedule(eventId: string, input: ScheduleInput): Promise<Schedule> {
  return (await api.post(`/events/${eventId}/schedules`, input)).data.data.schedule
}

export async function updateSchedule(id: string, input: Partial<ScheduleInput> & { status?: 'CANCELLED' }): Promise<Schedule> {
  return (await api.patch(`/schedules/${id}`, input)).data.data.schedule
}

export async function deleteSchedule(id: string): Promise<void> {
  await api.delete(`/schedules/${id}`)
}

// --- Ticket types and seat plan -------------------------------------------------

export interface TicketTypeInput {
  code: string
  name: string
  price: number
  inventoryMode: 'RESERVED' | 'GENERAL_ADMISSION'
  capacity?: number
  venueZoneId?: string | null
  maxPerOrder?: number
}

export async function createTicketType(scheduleId: string, input: TicketTypeInput): Promise<ScheduleTicketType> {
  return (await api.post(`/schedules/${scheduleId}/ticket-types`, input)).data.data.ticketType
}

export async function deleteTicketType(id: string): Promise<void> {
  await api.delete(`/ticket-types/${id}`)
}

export interface SeatPlanAssignment {
  ticketTypeId: string
  zoneId: string
  rows: string[]
}

export interface SeatPlanDetail {
  totalAssignedSeats: number
  assignments: Array<{ seatId: string; ticketTypeId: string }>
}

export async function getSeatPlanDetail(scheduleId: string): Promise<SeatPlanDetail> {
  return (await api.get(`/schedules/${scheduleId}/seat-plan`)).data.data
}

/** Replaces the whole plan of the schedule. */
export async function saveSeatPlan(scheduleId: string, assignments: Array<SeatPlanAssignment | { ticketTypeId: string; seatIds: string[] }>): Promise<void> {
  await api.put(`/schedules/${scheduleId}/seat-plan`, { assignments })
}

// --- After publishing -----------------------------------------------------------

export async function getScheduleSeatMap(scheduleId: string): Promise<SeatMap> {
  return (await api.get(`/schedules/${scheduleId}/seat-map`)).data.data
}

/** SEAT-02: block seats (broken, reserved for guests) or put them back on sale. */
export async function changeSeatBlocks(scheduleId: string, action: 'BLOCK' | 'UNBLOCK', seatIds: string[], reason: string) {
  return (await api.post(`/schedules/${scheduleId}/inventory/block`, { action, seatIds, reason })).data.data as {
    applied: string[]
    rejected: Array<{ seatId: string; status: string }>
  }
}

export interface StaffMember {
  userId: string
  email: string
  firstName: string
  lastName: string
  assignedAt: string
}

export async function listStaff(eventId: string): Promise<StaffMember[]> {
  return (await api.get(`/events/${eventId}/staff`)).data.data.staff
}

export async function addStaff(eventId: string, email: string): Promise<StaffMember> {
  return (await api.post(`/events/${eventId}/staff`, { email })).data.data.staff
}

export async function removeStaff(eventId: string, userId: string): Promise<void> {
  await api.delete(`/events/${eventId}/staff/${userId}`)
}

export interface CheckInStats {
  scheduleId: string
  total: number
  checkedIn: number
  byTicketType: Array<{ ticketTypeId: string; ticketTypeName: string; total: number; checkedIn: number }>
}

export async function getCheckInStats(scheduleId: string): Promise<CheckInStats> {
  return (await api.get(`/schedules/${scheduleId}/check-in-stats`)).data.data.stats
}

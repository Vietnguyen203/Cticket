import { api } from './client'
import type { Category, EventDetail, EventSummary, PageMeta } from './types'

/** API calls of the admin pages (Phase 12). Permissions are checked by the API. */

// --- Organizers -------------------------------------------------------------

export type OrganizerStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED'

export interface OrganizerProfile {
  id: string
  userId: string
  userEmail?: string
  organizationName: string
  description: string | null
  taxCode: string | null
  status: OrganizerStatus
  createdAt: string
}

export async function listOrganizers(params: { status?: OrganizerStatus; page?: number; pageSize?: number }) {
  const res = await api.get('/organizers', { params })
  return { organizers: res.data.data.organizers as OrganizerProfile[], meta: res.data.meta as PageMeta }
}

export async function changeOrganizerStatus(id: string, status: Exclude<OrganizerStatus, 'PENDING'>, reason?: string) {
  return (await api.patch(`/organizers/${id}/status`, { status, ...(reason ? { reason } : {}) })).data.data.organizer as OrganizerProfile
}

// --- Categories -------------------------------------------------------------

export interface CategoryInput {
  name: string
  description?: string | null
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  return (await api.post('/categories', input)).data.data.category
}

export async function updateCategory(id: string, input: Partial<CategoryInput>): Promise<Category> {
  return (await api.patch(`/categories/${id}`, input)).data.data.category
}

export async function deleteCategory(id: string): Promise<void> {
  await api.delete(`/categories/${id}`)
}

// --- Venues, zones, seats ---------------------------------------------------

export type VenueStatus = 'ACTIVE' | 'INACTIVE'

export interface VenueRecord {
  id: string
  name: string
  addressLine: string
  city: string
  province: string | null
  country: string
  capacity: number | null
  status: VenueStatus
  createdAt: string
}

export interface VenueInput {
  name: string
  addressLine: string
  city: string
  province?: string | null
  capacity?: number | null
  status?: VenueStatus
}

export type ZoneKind = 'SEATED' | 'STANDING'

export interface LayoutSeat {
  id: string
  zoneId: string
  code: string
  rowLabel: string
  seatNumber: number
  seatType: string
}

export interface LayoutZone {
  id: string
  code: string
  name: string
  kind: ZoneKind
  capacity: number | null
  seats: LayoutSeat[]
}

export interface ZoneInput {
  code: string
  name: string
  kind: ZoneKind
  capacity?: number | null
}

export interface SeatRowInput {
  rowLabel: string
  from: number
  to: number
}

export async function listVenues(params: { q?: string; includeInactive?: boolean; page?: number; pageSize?: number }) {
  const res = await api.get('/venues', { params: { ...params, includeInactive: params.includeInactive ? 'true' : undefined } })
  return { venues: res.data.data.venues as VenueRecord[], meta: res.data.meta as PageMeta }
}

export async function getVenue(id: string): Promise<VenueRecord> {
  return (await api.get(`/venues/${id}`)).data.data.venue
}

export async function createVenue(input: VenueInput): Promise<VenueRecord> {
  return (await api.post('/venues', input)).data.data.venue
}

export async function updateVenue(id: string, input: Partial<VenueInput>): Promise<VenueRecord> {
  return (await api.patch(`/venues/${id}`, input)).data.data.venue
}

export async function getVenueLayout(id: string): Promise<{ venue: { id: string; name: string }; zones: LayoutZone[] }> {
  return (await api.get(`/venues/${id}/layout`)).data.data
}

export async function createZone(venueId: string, input: ZoneInput) {
  return (await api.post(`/venues/${venueId}/zones`, input)).data.data.zone as Omit<LayoutZone, 'seats'>
}

/** Creates seats row by row (A01…A20); existing seat codes are refused (SEAT_CODE_TAKEN). */
export async function createSeats(zoneId: string, rows: SeatRowInput[]): Promise<{ zoneId: string; created: number }> {
  return (await api.post(`/zones/${zoneId}/seats/bulk`, { rows })).data.data
}

// --- Events (review) --------------------------------------------------------

export type EventStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'CANCELLED' | 'FINISHED'

export async function listEventsByStatus(params: { status: EventStatus; q?: string; page?: number; pageSize?: number }) {
  const res = await api.get('/events', { params: { sort: '-createdAt', ...params } })
  return { events: res.data.data.events as EventSummary[], meta: res.data.meta as PageMeta }
}

export async function getEventForReview(id: string): Promise<EventDetail> {
  return (await api.get(`/events/${id}`)).data.data.event
}

/** Approve (PUBLISHED), reject (DRAFT, reason) or cancel (CANCELLED, reason: paid orders are refunded). */
export async function changeEventStatus(id: string, status: 'PUBLISHED' | 'DRAFT' | 'CANCELLED', reason?: string): Promise<EventDetail> {
  return (await api.patch(`/events/${id}/status`, { status, ...(reason ? { reason } : {}) })).data.data.event
}

export interface ScheduleTicketType {
  id: string
  code: string
  name: string
  price: number
  inventoryMode: 'RESERVED' | 'GENERAL_ADMISSION'
  capacity: number | null
  maxPerOrder: number
  status: string
}

export async function listTicketTypes(scheduleId: string): Promise<ScheduleTicketType[]> {
  return (await api.get(`/schedules/${scheduleId}/ticket-types`)).data.data.ticketTypes
}

export interface SeatPlanSummary {
  scheduleId: string
  totalAssignedSeats: number
  ticketTypes: Array<{ ticketTypeId: string; code: string; name: string; seats: number }>
}

export async function getSeatPlan(scheduleId: string): Promise<SeatPlanSummary> {
  return (await api.get(`/schedules/${scheduleId}/seat-plan`)).data.data
}

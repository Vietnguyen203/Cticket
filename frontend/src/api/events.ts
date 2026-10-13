import { api } from './client'
import type { Category, EventDetail, EventSummary, PageMeta, SeatMap, TicketTypeAvailability } from './types'

export interface EventFilters {
  q?: string
  categoryId?: string
  city?: string
  dateFrom?: string
  dateTo?: string
  sort?: 'startAt' | '-startAt' | '-publishedAt' | 'title'
  page?: number
  pageSize?: number
}

/** Published events with an upcoming schedule (cached by the API for a minute). */
export async function listEvents(filters: EventFilters = {}): Promise<{ events: EventSummary[]; meta: PageMeta }> {
  const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''))
  const res = await api.get('/events', { params })
  return { events: res.data.data.events, meta: res.data.meta }
}

/** By id or slug. */
export async function getEvent(idOrSlug: string): Promise<EventDetail> {
  return (await api.get(`/events/${encodeURIComponent(idOrSlug)}`)).data.data.event
}

export async function listCategories(): Promise<Category[]> {
  return (await api.get('/categories')).data.data.categories
}

/** Ticket types on sale for a schedule, with what is left. */
export async function getAvailability(scheduleId: string): Promise<TicketTypeAvailability[]> {
  return (await api.get(`/schedules/${scheduleId}/availability`)).data.data.ticketTypes
}

/** Seat statuses (+ versions) and ticket counts right now; layout part cached by the API. */
export async function getSeatMap(scheduleId: string): Promise<SeatMap> {
  return (await api.get(`/schedules/${scheduleId}/seat-map`)).data.data
}

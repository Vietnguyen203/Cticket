import { api } from './client'

/** Phase 12.4. Money is in VND (integers); days are Vietnamese calendar days "YYYY-MM-DD". */
export interface Refunds {
  orders: number
  amount: number
}

export interface DayRow {
  date: string
  orders: number
  tickets: number
  revenue: number
  refunds: Refunds
}

export interface Places {
  capacity: number
  blocked: number
  tickets: number
  checkedIn: number
  /** sold ÷ (capacity − blocked); null when nothing can be sold */
  fillRate: number | null
}

export interface MoneyTotals {
  orders: number
  gross: number
  discount: number
  revenue: number
  refunds: Refunds
}

export interface TicketTypeSales {
  id: string
  name: string
  price: number
  mode: 'RESERVED' | 'GENERAL_ADMISSION'
  capacity: number
  blocked: number
  sold: number
  fillRate: number | null
  /** before discounts (a code applies to the whole order) */
  revenue: number
  checkedIn: number
}

export interface EventSales {
  event: { id: string; title: string; slug: string; status: string }
  totals: MoneyTotals & Places
  schedules: Array<{
    id: string
    startAt: string
    endAt: string
    status: string
    venueName: string
    totals: MoneyTotals & Places
    ticketTypes: TicketTypeSales[]
  }>
  promotions: Array<{ code: string; name: string; orders: number; discount: number }>
  daily: DayRow[]
}

/** REP-01: the organizer of the event, or an admin. */
export async function getEventSales(eventId: string): Promise<EventSales> {
  return (await api.get(`/reports/events/${eventId}/sales`)).data.data
}

export interface MyEventLine {
  id: string
  title: string
  slug: string
  status: string
  nextStartAt: string | null
  capacity: number
  blocked: number
  orders: number
  tickets: number
  fillRate: number | null
  revenue: number
  refunds: Refunds
}

/** REP-01b: one line per event of my organizer. */
export async function getMyEventsSales(): Promise<{
  events: MyEventLine[]
  totals: { orders: number; tickets: number; revenue: number; refunds: Refunds }
  truncated: boolean
}> {
  return (await api.get('/reports/my-events')).data.data
}

export interface TopEvent {
  id: string
  title: string
  slug: string
  organizerName: string
  orders: number
  tickets: number
  revenue: number
}

export interface PlatformSales {
  range: { from: string; to: string }
  totals: MoneyTotals & { tickets: number; buyers: number }
  daily: DayRow[]
  topEvents: TopEvent[]
  byOrganizer: Array<{ id: string; name: string; orders: number; tickets: number; revenue: number }>
}

/** REP-02: admins. At most 366 days, not in the future. */
export async function getPlatformSales(from: string, to: string): Promise<PlatformSales> {
  return (await api.get('/reports/sales', { params: { from, to } })).data.data
}

export interface PeriodTotals {
  orders: number
  tickets: number
  revenue: number
  refunds: Refunds
}

export interface Overview {
  today: PeriodTotals
  last7Days: PeriodTotals
  last30Days: PeriodTotals
  daily: DayRow[]
  topEvents: TopEvent[]
  publishedEvents: number
  newUsers7Days: number
}

/** Admin dashboard. */
export async function getOverview(): Promise<Overview> {
  return (await api.get('/reports/overview')).data.data
}

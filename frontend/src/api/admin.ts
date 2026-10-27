import { api } from './client'
import type { Category, EventDetail, EventSummary, Order, PageMeta, Role } from './types'

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

/** Events (any status) per category id: a used category cannot be deleted. */
export async function getCategoryUsage(): Promise<Record<string, number>> {
  const usage: Array<{ categoryId: string; events: number }> = (await api.get('/categories/usage')).data.data.usage
  return Object.fromEntries(usage.map((u) => [u.categoryId, u.events]))
}

// --- Venues, zones, seats ---------------------------------------------------

export type VenueStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING'

export interface VenueRecord {
  id: string
  name: string
  addressLine: string
  city: string
  province: string | null
  country: string
  capacity: number | null
  status: VenueStatus
  /** Set when an organizer proposed the venue (PENDING until approved) */
  createdByOrganizerId: string | null
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

export async function listVenues(params: { q?: string; includeInactive?: boolean; status?: VenueStatus; page?: number; pageSize?: number }) {
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

export async function getVenueLayout(id: string): Promise<{ venue: { id: string; name: string; status: VenueStatus; capacity?: number | null }; zones: LayoutZone[] }> {
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

/** Events of one status, or of every status ('ALL'), newest first. */
export async function listEventsByStatus({ status, ...params }: { status: EventStatus | 'ALL'; q?: string; page?: number; pageSize?: number }) {
  const filter = status === 'ALL' ? { all: true } : { status }
  const res = await api.get('/events', { params: { sort: '-createdAt', ...filter, ...params } })
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
  venueZoneId?: string | null
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

// --- Users (USR-03/04/05) ---------------------------------------------------

export interface AdminUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'DELETED'
  emailVerifiedAt: string | null
  roles: Role[]
  twoFactorEnabled: boolean
  /** Phase 18.1: sign-in paused after wrong passwords until then (null = not locked) */
  loginLockedUntil: string | null
  createdAt: string
}

export async function listUsers(params: { q?: string; role?: Role; status?: string; page?: number; pageSize?: number }) {
  const res = await api.get('/admin/users', { params })
  return { users: res.data.data.users as AdminUser[], meta: res.data.meta as PageMeta }
}

/** Phase 15: someone lost their phone: two-factor off, logged out everywhere (reason required). */
export async function resetUserTwoFactor(id: string, reason: string): Promise<AdminUser> {
  return (await api.post(`/admin/users/${id}/2fa/reset`, { reason })).data.data.user
}

/** Phase 18.1: end a sign-in lock (after wrong passwords) early. */
export async function unlockUserLogin(id: string): Promise<AdminUser> {
  return (await api.post(`/admin/users/${id}/login-unlock`)).data.data.user
}

/** Suspending logs the user out everywhere at once (reason required). */
export async function setUserStatus(id: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string): Promise<AdminUser> {
  return (await api.patch(`/admin/users/${id}/status`, { status, ...(reason ? { reason } : {}) })).data.data.user
}

export async function setUserRoles(id: string, roles: Role[]): Promise<AdminUser> {
  return (await api.put(`/admin/users/${id}/roles`, { roles })).data.data.user
}

// --- Audit log (AUD-02) -----------------------------------------------------

export interface AuditLog {
  id: string
  userId: string | null
  userEmail: string | null
  action: string
  entityType: string
  entityId: string | null
  oldValue: unknown
  newValue: unknown
  ipAddress: string | null
  createdAt: string
}

export interface AuditFilters {
  entityType?: string
  entityId?: string
  action?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export async function listAuditLogs(params: AuditFilters) {
  const res = await api.get('/admin/audit-logs', { params })
  return { auditLogs: res.data.data.auditLogs as AuditLog[], meta: res.data.meta as PageMeta }
}

export async function listAuditActions(): Promise<string[]> {
  return (await api.get('/admin/audit-logs/actions')).data.data.actions
}

// --- Orders, payments, tickets (ORD-05, PAY-05, TKT-03) ---------------------

export async function listAllOrders(params: { q?: string; status?: string; page?: number; pageSize?: number }) {
  const res = await api.get('/orders', { params: { all: 'true', ...params } })
  return { orders: res.data.data.orders as Order[], meta: res.data.meta as PageMeta }
}

export async function getOrderDetail(id: string): Promise<Order> {
  return (await api.get(`/orders/${id}`)).data.data.order
}

/** Phase 17: send a VNPay refund again after VNPay refused it or did not answer. */
export async function retryRefund(refundId: string) {
  return (await api.post(`/payments/refunds/${refundId}/retry`)).data.data.refund
}

/** TKT-03: a new QR for a valid ticket; the old one stops opening the gate. */
export async function reissueTicketQr(ticketId: string) {
  return (await api.post(`/admin/tickets/${ticketId}/reissue-qr`)).data.data.ticket
}

// --- Promotions (PRO-02) ----------------------------------------------------

export type DiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT'
export type PromotionStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED'

export interface Promotion {
  id: string
  code: string
  name: string
  discountType: DiscountType
  discountValue: number
  maxDiscount: number | null
  minOrderAmount: number
  usageLimit: number | null
  usedCount: number
  perUserLimit: number | null
  startsAt: string
  expiresAt: string
  status: PromotionStatus
}

export type PromotionInput = Omit<Promotion, 'id' | 'usedCount'>

export async function listPromotions(params: { status?: PromotionStatus; page?: number; pageSize?: number }) {
  const res = await api.get('/promotions', { params })
  return { promotions: res.data.data.promotions as Promotion[], meta: res.data.meta as PageMeta }
}

export async function createPromotion(input: PromotionInput): Promise<Promotion> {
  return (await api.post('/promotions', input)).data.data.promotion
}

export async function updatePromotion(id: string, input: Partial<Omit<PromotionInput, 'code'>>): Promise<Promotion> {
  return (await api.patch(`/promotions/${id}`, input)).data.data.promotion
}

/** Shapes returned by the API, written by hand from the backend's responses. */

export type Role = 'CUSTOMER' | 'ORGANIZER' | 'STAFF' | 'ADMIN'

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
  status: string
  emailVerifiedAt: string | null
  createdAt: string
  roles?: Role[]
  permissions?: string[]
}

export interface LoginResult {
  tokenType: 'Bearer'
  accessToken: string
  expiresIn: number
  user: User
}

export type OtpPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'

export interface PageMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// --- Catalogue (Phase 3) ----------------------------------------------------

export interface Category {
  id: string
  name: string
  slug: string
}

export interface Organizer {
  id: string
  name: string
}

export interface EventSummary {
  id: string
  slug: string
  title: string
  thumbnailUrl: string | null
  status: string
  publishedAt: string | null
  /** First upcoming schedule (null if none) */
  nextStartAt: string | null
  cities: string[]
  organizer: Organizer
  categories: Category[]
}

export interface Venue {
  id: string
  name: string
  city: string
  addressLine: string
}

export type ScheduleStatus = 'SCHEDULED' | 'CANCELLED' | 'FINISHED'

export interface Schedule {
  id: string
  eventId: string
  startAt: string
  endAt: string
  salesStartAt: string
  salesEndAt: string
  status: ScheduleStatus
  /** Set once the event is approved: tickets exist and can be sold. */
  inventoryGeneratedAt: string | null
  venue: Venue
}

export interface EventDetail {
  id: string
  slug: string
  title: string
  description: string | null
  bannerUrl: string | null
  thumbnailUrl: string | null
  ageRestriction: number | null
  status: string
  organizer: Organizer
  categories: Category[]
  schedules: Schedule[]
}

// --- Seat map (Phases 4, 7) -------------------------------------------------

export type SeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED'
export type InventoryMode = 'RESERVED' | 'GENERAL_ADMISSION'

export interface TicketTypeAvailability {
  id: string
  code: string
  name: string
  description: string | null
  price: number
  currency: string
  inventoryMode: InventoryMode
  status: string
  maxPerOrder: number
  venueZoneId: string | null
  total: number
  available: number
}

export interface Seat {
  seatId: string
  code: string
  rowLabel: string
  seatNumber: number
  seatType: string
  ticketTypeId: string | null
  price: number | null
  status: SeatStatus
  /** Bumped on every change: lets real-time updates that arrive late be ignored. */
  version: number
}

export interface Zone {
  id: string
  code: string
  name: string
  kind: 'SEATED' | 'STANDING'
  capacity: number | null
  seats: Seat[]
  generalAdmission: Array<{ ticketTypeId: string; available: number; total: number }>
}

export interface SeatMap {
  scheduleId: string
  ticketTypes: TicketTypeAvailability[]
  zones: Zone[]
}

// --- Orders (Phases 5, 8) ---------------------------------------------------

export type OrderStatus =
  | 'PENDING'
  | 'HELD'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_FAILED'
  | 'PAID'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDED'

export interface OrderItem {
  id: string
  ticketTypeId: string
  ticketTypeName: string
  seatId: string | null
  seatLabel: string | null
  unitPrice: number
  quantity: number
  totalAmount: number
}

export interface Order {
  id: string
  orderCode: string
  status: OrderStatus
  event: { id: string; title: string; slug: string }
  schedule: { id: string; startAt: string; venueName: string }
  items: OrderItem[]
  subtotal: number
  discountAmount: number
  totalAmount: number
  currency: string
  expiresAt: string | null
  remainingSeconds: number | null
  checkedOutAt: string | null
  paidAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
  /** Admins see the buyer */
  buyerEmail?: string
  /** Order detail only */
  payments?: Array<{ id: string; status: string; amount: number; provider: string; failureCode: string | null; paidAt: string | null; createdAt: string }>
  tickets?: Array<{ id: string; code: string; seatLabel: string | null; ticketTypeName: string; admissionNo: number; status: string; issuedAt: string }>
}

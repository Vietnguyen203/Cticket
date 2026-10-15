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
  /** Phase 18.2: reminder emails 24 h / 2 h before the show */
  eventReminders?: boolean
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

/**
 * Phase 15: the password was right, a second step is needed. `mfaRequired`:
 * enter a code from the authenticator app; `mfaSetupRequired`: an admin who
 * must set two-factor up first. The mfaToken lasts 5 minutes.
 */
export interface MfaChallenge {
  mfaRequired?: true
  mfaSetupRequired?: true
  mfaToken: string
  expiresIn: number
}

/** What the phone needs: the QR code, or the key typed in by hand. */
export interface TwoFactorSetup {
  secret: string
  otpauthUri: string
  qrDataUrl: string
}

export interface TwoFactorStatus {
  enabled: boolean
  enabledAt: string | null
  /** Required for this account's roles (admins): cannot be turned off */
  required: boolean
  recoveryCodesLeft: number
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
  description?: string | null
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
  /** Phase 18.3: NONE / STANDARD / FLEXIBLE (payments/refundPolicy.ts) */
  refundPolicy?: string
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
  /** For this viewer: places kept for someone else on the waiting list are already taken off */
  available: number
  /** Phase 18.4: places kept for people on the waiting list */
  waitlistKept?: number
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

/** One payment attempt of an order (order detail). */
export interface OrderPayment {
  id: string
  /** PENDING: a VNPay attempt still waiting for VNPay's answer (Phase 17) */
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED'
  amount: number
  /** SIMULATOR or VNPAY */
  provider: string
  /** Why it failed: the simulator's code, or VNPay's response code (24 cancelled, 51 no funds…) */
  failureCode: string | null
  /** VNPay's transaction number (vnp_TransactionNo) */
  providerTransactionId: string | null
  providerResponseCode: string | null
  bankCode: string | null
  paidAt: string | null
  createdAt: string
}

/** Money given back (Phase 17: VNPay refunds go through a queue, so they have a status). */
export interface OrderRefund {
  id: string
  paymentId: string
  amount: number
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
  reason: string | null
  /** Why VNPay refused or did not answer (FAILED); an admin can send it again */
  failureMessage: string | null
  attempts: number
  providerRefundId: string | null
  createdAt: string
  completedAt: string | null
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
  payments?: OrderPayment[]
  refunds?: OrderRefund[]
  tickets?: Array<{ id: string; code: string; seatLabel: string | null; ticketTypeName: string; admissionNo: number; status: string; issuedAt: string }>
}

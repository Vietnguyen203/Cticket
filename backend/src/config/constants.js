/**
 * Business constants and database enum values used in code.
 * Keep enum values identical to the PostgreSQL ENUM types in the migrations.
 */

const ROLES = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  ORGANIZER: 'ORGANIZER',
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
});

const USER_STATUS = Object.freeze({
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
  // The user deleted their account: personal data removed, the row kept anonymised (modules/account).
  DELETED: 'DELETED',
});

/** Values of the user_token_type enum = purposes of an OTP code. */
const OTP_PURPOSE = Object.freeze({
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
});

const OTP = Object.freeze({
  LENGTH: 6,
  TTL_MINUTES: 10,
  // Wrong guesses allowed before the code is revoked.
  // 5 guesses out of 1,000,000 codes = 0.0005% chance per code.
  MAX_ATTEMPTS: 5,
  // Minimum gap between two codes for the same user and purpose.
  RESEND_COOLDOWN_SECONDS: 60,
  // Hard cap on codes per user and purpose per hour (stops email spam).
  MAX_PER_HOUR: 5,
});

/** Phase 15: two-factor authentication (TOTP codes come from src/utils/totp.js). */
const TWO_FACTOR = Object.freeze({
  // Between the password and the code: how long the login may wait, and how many wrong codes it gets.
  MFA_TOKEN_TTL_SECONDS: 300,
  MAX_ATTEMPTS: 5,
  RECOVERY_CODES: 10,
});

// Phase 18.1: wrong passwords (and two-factor codes) per email before a pause.
const LOGIN_LOCK = Object.freeze({
  FAILURES: 5,
  FIRST_LOCK_SECONDS: 15 * 60, // doubled at each further lock of a streak
  MAX_LOCK_SECONDS: 24 * 60 * 60,
  STREAK_RESET_SECONDS: 24 * 60 * 60, // a day without a failure starts over
});

// Phase 18.4: the waiting list of a sold-out ticket type.
const WAITLIST_STATUS = Object.freeze({
  WAITING: 'WAITING',
  OFFERED: 'OFFERED',
  BOOKED: 'BOOKED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  CLOSED: 'CLOSED',
});
const WAITLIST = Object.freeze({
  OFFER_MINUTES: 30, // places kept for the person offered them
  TYPES_PER_RUN: 200, // ticket types the offer job looks at per run
});

// Phase 19: event reviews.
const REVIEW_STATUS = Object.freeze({ PUBLISHED: 'PUBLISHED', HIDDEN: 'HIDDEN' });
const REVIEW = Object.freeze({
  EDIT_DAYS_AFTER_SHOW: 60, // writing / editing closes this long after the show ends
  INVITE_HOURS_AFTER_SHOW: 24, // the "how was the show?" email
  MAX_COMMENT: 2000,
  MAX_REPLY: 1000,
});

/** Phase 21: purchase queue ("waiting room") of an event. */
const PURCHASE_QUEUE = Object.freeze({
  DEFAULT_CAPACITY: 100,
  MAX_CAPACITY: 10_000,
  DEFAULT_SESSION_MINUTES: 10,
  MIN_SESSION_MINUTES: 5,
  MAX_SESSION_MINUTES: 30,
  KEY_TTL_SECONDS: 24 * 60 * 60, // renewed on every use: a forgotten queue disappears a day later
  ADMIT_INTERVAL_SECONDS: 5, // the admission job (safety net for turns that ran out)
});

const PASSWORD = Object.freeze({
  MIN_LENGTH: 8,
  // bcrypt ignores everything after 72 BYTES. Vietnamese letters take 2-3
  // bytes in UTF-8, so the limit is checked in bytes, not characters.
  MAX_BYTES: 72,
});

const ORGANIZER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REJECTED: 'REJECTED',
});

const EVENT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  PUBLISHED: 'PUBLISHED',
  CANCELLED: 'CANCELLED',
  FINISHED: 'FINISHED',
});

const SCHEDULE_STATUS = Object.freeze({
  SCHEDULED: 'SCHEDULED',
  CANCELLED: 'CANCELLED',
  FINISHED: 'FINISHED',
});

const VENUE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  PENDING: 'PENDING', // proposed by an organizer, waiting for an admin (Phase 12.2)
});

const ZONE_KIND = Object.freeze({
  SEATED: 'SEATED', // contains physical, numbered seats
  STANDING: 'STANDING', // capacity only, no seat rows
});

const INVENTORY_MODE = Object.freeze({
  RESERVED: 'RESERVED', // customer gets a specific seat
  GENERAL_ADMISSION: 'GENERAL_ADMISSION', // customer buys a quantity
});

const TICKET_TYPE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE', // sales paused
  // SOLD_OUT exists in the enum but is never stored: it is computed from inventory.
});

const SEAT_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  SOLD: 'SOLD',
  BLOCKED: 'BLOCKED',
});

const INVENTORY_LIMITS = Object.freeze({
  MAX_SEATS_PER_BULK_CREATE: 2000,
  DEFAULT_MAX_PER_ORDER: 10, // CTicket example: 10 tickets per transaction
  SEAT_SPACING: 30, // default seat-map spacing (layout units)
});

const ORDER_STATUS = Object.freeze({
  PENDING: 'PENDING',
  HELD: 'HELD', // inventory is held, waiting for payment (Phase 8)
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAID: 'PAID',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REFUNDED: 'REFUNDED',
});

/** Orders that still hold inventory (same list as the uq_orders_active_cart index). */
const ACTIVE_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.HELD,
  ORDER_STATUS.PAYMENT_PENDING,
  ORDER_STATUS.PAYMENT_FAILED,
]);

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
});

/**
 * SIMULATOR: decides SUCCESS / FAILED as the client asks (dev, tests, demos).
 * VNPAY (Phase 17): redirect to VNPay, result by IPN / querydr.
 */
const PAYMENT_PROVIDER = Object.freeze({ SIMULATOR: 'SIMULATOR', VNPAY: 'VNPAY' });

/** Phase 17: VNPay payments. */
const VNPAY = Object.freeze({
  // VNPay stops taking money this long before the order's hold ends, so its
  // IPN has time to arrive before the seats would be released.
  EXPIRE_MARGIN_SECONDS: 120,
  // Starting a payment needs at least this much time left on the order.
  MIN_SECONDS_TO_PAY: 180,
  // A pending attempt VNPay cannot be asked about is given this long after the
  // order's deadline before the order expires anyway (late money is refunded).
  UNKNOWN_GRACE_SECONDS: 600,
  RECONCILE_BATCH_SIZE: 50,
  REFUND_ATTEMPTS: 5,
});

const DISCOUNT_TYPE = Object.freeze({ PERCENTAGE: 'PERCENTAGE', FIXED_AMOUNT: 'FIXED_AMOUNT' });

const PROMOTION_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', EXPIRED: 'EXPIRED' });

const CANCEL_REASON = Object.freeze({
  USER_CANCELLED: 'USER_CANCELLED',
  ADMIN_CANCELLED: 'ADMIN_CANCELLED',
  EVENT_CANCELLED: 'EVENT_CANCELLED',
  SCHEDULE_CANCELLED: 'SCHEDULE_CANCELLED',
});

const ORDER_LIMITS = Object.freeze({
  MAX_TICKETS_PER_ORDER: 8, // requirements sheet (BKG-03); each ticket type's max_per_order applies too
  EXPIRE_BATCH_SIZE: 100, // orders expired per sweep / per lazy clean-up
});

const TICKET_STATUS = Object.freeze({
  VALID: 'VALID',
  USED: 'USED', // checked in
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
});

const CHECKIN = Object.freeze({
  // Gates open this long before the show; check-in closes when the show ends.
  OPENS_MINUTES_BEFORE_START: 180,
});

const PAGINATION = Object.freeze({
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 50,
});

const EVENT_LIMITS = Object.freeze({
  MAX_CATEGORIES: 5,
});

// The terms of sale in force (frontend/src/legal/terms.ts TERMS_VERSION, the
// /dieu-khoan page). A buyer accepts them at checkout; a new text gets a new
// version here and there, so a page left open on the old text is refused.
const TERMS_VERSION = '2026-10-27.2';

module.exports = {
  ROLES,
  USER_STATUS,
  OTP_PURPOSE,
  OTP,
  TWO_FACTOR,
  LOGIN_LOCK,
  WAITLIST_STATUS,
  WAITLIST,
  REVIEW_STATUS,
  REVIEW,
  PURCHASE_QUEUE,
  PASSWORD,
  ORGANIZER_STATUS,
  EVENT_STATUS,
  SCHEDULE_STATUS,
  VENUE_STATUS,
  ZONE_KIND,
  INVENTORY_MODE,
  TICKET_TYPE_STATUS,
  SEAT_STATUS,
  INVENTORY_LIMITS,
  ORDER_STATUS,
  ACTIVE_ORDER_STATUSES,
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  VNPAY,
  DISCOUNT_TYPE,
  PROMOTION_STATUS,
  CANCEL_REASON,
  ORDER_LIMITS,
  TICKET_STATUS,
  CHECKIN,
  PAGINATION,
  EVENT_LIMITS,
  TERMS_VERSION,
};

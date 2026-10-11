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

const PAGINATION = Object.freeze({
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 50,
});

const EVENT_LIMITS = Object.freeze({
  MAX_CATEGORIES: 5,
});

module.exports = {
  ROLES,
  USER_STATUS,
  OTP_PURPOSE,
  OTP,
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
  CANCEL_REASON,
  ORDER_LIMITS,
  PAGINATION,
  EVENT_LIMITS,
};

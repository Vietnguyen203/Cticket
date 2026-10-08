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

module.exports = { ROLES, USER_STATUS, OTP_PURPOSE, OTP, PASSWORD };

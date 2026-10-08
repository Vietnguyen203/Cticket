/**
 * Central error catalog: code → HTTP status + default (client-safe) message.
 * Services throw AppError(code); only this file decides the HTTP status.
 * New codes are added here as each phase introduces them.
 */
const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: { status: 400, message: 'The request is invalid.' },
  MALFORMED_JSON: { status: 400, message: 'The request body is not valid JSON.' },
  INVALID_OTP: { status: 400, message: 'The code is invalid or has expired.' },
  UNAUTHENTICATED: { status: 401, message: 'Authentication is required.' },
  INVALID_CREDENTIALS: { status: 401, message: 'Email or password is incorrect.' },
  TOKEN_EXPIRED: { status: 401, message: 'The access token has expired.' },
  INVALID_REFRESH_TOKEN: { status: 401, message: 'The session is invalid or has expired. Please log in again.' },
  REFRESH_TOKEN_REUSED: { status: 401, message: 'The session was revoked for security reasons. Please log in again.' },
  FORBIDDEN: { status: 403, message: 'You do not have permission to perform this action.' },
  EMAIL_NOT_VERIFIED: { status: 403, message: 'Please verify your email before logging in.' },
  ACCOUNT_DISABLED: { status: 403, message: 'This account is disabled.' },
  ORGANIZER_PROFILE_REQUIRED: { status: 403, message: 'An active organizer profile is required.' },
  NOT_FOUND: { status: 404, message: 'The requested resource was not found.' },
  DUPLICATE_RESOURCE: { status: 409, message: 'The resource already exists.' },
  EMAIL_TAKEN: { status: 409, message: 'This email is already registered.' },
  PHONE_TAKEN: { status: 409, message: 'This phone number is already registered.' },
  INVALID_STATE_TRANSITION: { status: 409, message: 'This status change is not allowed from the current status.' },
  ORGANIZER_ALREADY_EXISTS: { status: 409, message: 'You already have an organizer profile.' },
  TAX_CODE_TAKEN: { status: 409, message: 'This tax code is already registered.' },
  CATEGORY_SLUG_TAKEN: { status: 409, message: 'A category with this slug already exists.' },
  CATEGORY_IN_USE: { status: 409, message: 'This category is used by events and cannot be deleted.' },
  SCHEDULE_CONFLICT: { status: 409, message: 'The venue already has a schedule at an overlapping time.' },
  RESOURCE_LOCKED: { status: 409, message: 'The resource is busy. Please try again.' },
  CONCURRENCY_CONFLICT: { status: 409, message: 'The request conflicted with another request. Please try again.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'The request body is too large.' },
  REFERENCED_RESOURCE_NOT_FOUND: { status: 422, message: 'A referenced resource does not exist.' },
  CONSTRAINT_VIOLATION: { status: 422, message: 'The request violates a business rule.' },
  CATEGORY_NOT_FOUND: { status: 422, message: 'One or more categories do not exist.' },
  VENUE_NOT_AVAILABLE: { status: 422, message: 'The venue does not exist or is inactive.' },
  EVENT_NOT_EDITABLE: { status: 422, message: 'The event cannot be changed in its current status.' },
  EVENT_HAS_NO_SCHEDULES: { status: 422, message: 'Add at least one upcoming schedule before submitting.' },
  REASON_REQUIRED: { status: 422, message: 'A reason is required for this action.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please slow down.' },
  INTERNAL_ERROR: { status: 500, message: 'An unexpected error occurred.' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'The service is temporarily unavailable.' },
});

module.exports = { ERROR_CODES };

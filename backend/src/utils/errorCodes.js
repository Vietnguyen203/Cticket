/**
 * Central error catalog: code → HTTP status + default (client-safe) message.
 * Services throw AppError(code); only this file decides the HTTP status.
 * New codes are added here as each phase introduces them.
 */
const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: { status: 400, message: 'The request is invalid.' },
  MALFORMED_JSON: { status: 400, message: 'The request body is not valid JSON.' },
  UNAUTHENTICATED: { status: 401, message: 'Authentication is required.' },
  FORBIDDEN: { status: 403, message: 'You do not have permission to perform this action.' },
  NOT_FOUND: { status: 404, message: 'The requested resource was not found.' },
  DUPLICATE_RESOURCE: { status: 409, message: 'The resource already exists.' },
  RESOURCE_LOCKED: { status: 409, message: 'The resource is busy. Please try again.' },
  CONCURRENCY_CONFLICT: { status: 409, message: 'The request conflicted with another request. Please try again.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'The request body is too large.' },
  REFERENCED_RESOURCE_NOT_FOUND: { status: 422, message: 'A referenced resource does not exist.' },
  CONSTRAINT_VIOLATION: { status: 422, message: 'The request violates a business rule.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please slow down.' },
  INTERNAL_ERROR: { status: 500, message: 'An unexpected error occurred.' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'The service is temporarily unavailable.' },
});

module.exports = { ERROR_CODES };

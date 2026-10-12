const AppError = require('../utils/AppError');

/** PostgreSQL SQLSTATE codes we handle explicitly. */
const PG_ERROR = Object.freeze({
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  EXCLUSION_VIOLATION: '23P01',
  LOCK_NOT_AVAILABLE: '55P03', // lock_timeout expired or NOWAIT failed
  DEADLOCK_DETECTED: '40P01',
  SERIALIZATION_FAILURE: '40001',
});

/**
 * Constraint name → specific business error code. Filled in as modules are
 * built. Unlisted constraints fall back to the generic code for their SQLSTATE.
 *
 * Mapping the constraint (instead of checking "does this email exist?" before
 * inserting) is what makes duplicates race-free: two concurrent registrations
 * cannot both pass, the UNIQUE index rejects the second one.
 * @type {Record<string, string>}
 */
const CONSTRAINT_ERROR_CODES = {
  users_email_key: 'EMAIL_TAKEN',
  users_phone_key: 'PHONE_TAKEN',
  organizers_user_id_key: 'ORGANIZER_ALREADY_EXISTS',
  organizers_tax_code_key: 'TAX_CODE_TAKEN',
  categories_slug_key: 'CATEGORY_SLUG_TAKEN',
  event_categories_category_id_fkey: 'CATEGORY_NOT_FOUND',
  event_schedules_venue_id_fkey: 'VENUE_NOT_AVAILABLE',
  excl_event_schedules_venue_overlap: 'SCHEDULE_CONFLICT',
  venue_zones_venue_id_code_key: 'ZONE_CODE_TAKEN',
  seats_venue_zone_id_seat_code_key: 'SEAT_CODE_TAKEN',
  ticket_types_schedule_id_code_key: 'TICKET_TYPE_CODE_TAKEN',
  // Over-capacity on GA counters is normally prevented by conditional UPDATEs;
  // if a bug ever tries it, the CHECK fires and the client gets a clear 409.
  chk_ga_inventory_capacity: 'INSUFFICIENT_INVENTORY',
  uq_orders_active_cart: 'ACTIVE_ORDER_EXISTS',
  promotions_code_key: 'PROMOTION_CODE_TAKEN',
  // Backstops: the payment flow checks these first while holding the order lock.
  uq_payments_order_active: 'ORDER_ALREADY_PAID',
  uq_refunds_payment_active: 'PAYMENT_NOT_REFUNDABLE',
};

const GENERIC_CODE_BY_SQLSTATE = {
  [PG_ERROR.UNIQUE_VIOLATION]: 'DUPLICATE_RESOURCE',
  [PG_ERROR.FOREIGN_KEY_VIOLATION]: 'REFERENCED_RESOURCE_NOT_FOUND',
  [PG_ERROR.CHECK_VIOLATION]: 'CONSTRAINT_VIOLATION',
  [PG_ERROR.NOT_NULL_VIOLATION]: 'CONSTRAINT_VIOLATION',
  [PG_ERROR.EXCLUSION_VIOLATION]: 'DUPLICATE_RESOURCE',
  [PG_ERROR.LOCK_NOT_AVAILABLE]: 'RESOURCE_LOCKED',
  [PG_ERROR.DEADLOCK_DETECTED]: 'CONCURRENCY_CONFLICT',
  [PG_ERROR.SERIALIZATION_FAILURE]: 'CONCURRENCY_CONFLICT',
};

function isPgError(err) {
  // node-postgres errors carry a 5-character SQLSTATE and a severity field.
  return Boolean(err) && typeof err.code === 'string' && err.code.length === 5 && 'severity' in err;
}

/**
 * Translate a PostgreSQL error into a client-safe AppError, or return null if
 * it is not one we know how to translate (it then becomes a 500).
 * The raw SQL, table and column names are never exposed to the client; the
 * original error is kept as `cause` for logging.
 */
function mapDatabaseError(err) {
  if (!isPgError(err)) return null;

  const code = CONSTRAINT_ERROR_CODES[err.constraint] ?? GENERIC_CODE_BY_SQLSTATE[err.code];
  if (!code) return null;

  return new AppError(code, undefined, { cause: err });
}

module.exports = { PG_ERROR, CONSTRAINT_ERROR_CODES, isPgError, mapDatabaseError };

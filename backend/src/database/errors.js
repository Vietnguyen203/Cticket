const AppError = require('../utils/AppError');

/** PostgreSQL SQLSTATE codes we handle explicitly. */
const PG_ERROR = Object.freeze({
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
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
};

const GENERIC_CODE_BY_SQLSTATE = {
  [PG_ERROR.UNIQUE_VIOLATION]: 'DUPLICATE_RESOURCE',
  [PG_ERROR.FOREIGN_KEY_VIOLATION]: 'REFERENCED_RESOURCE_NOT_FOUND',
  [PG_ERROR.CHECK_VIOLATION]: 'CONSTRAINT_VIOLATION',
  [PG_ERROR.NOT_NULL_VIOLATION]: 'CONSTRAINT_VIOLATION',
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

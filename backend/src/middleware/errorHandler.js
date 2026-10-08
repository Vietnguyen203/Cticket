const AppError = require('../utils/AppError');
const { mapDatabaseError } = require('../database/errors');

const SERVER_ERROR_STATUS = 500;

/**
 * Normalize anything thrown in the app into an AppError.
 * Unknown errors become INTERNAL_ERROR so internals never leak to clients.
 */
function toAppError(err) {
  if (err instanceof AppError) return err;

  // Errors raised by express.json() (body-parser).
  if (err?.type === 'entity.parse.failed') return new AppError('MALFORMED_JSON', undefined, { cause: err });
  if (err?.type === 'entity.too.large') return new AppError('PAYLOAD_TOO_LARGE', undefined, { cause: err });

  return mapDatabaseError(err) ?? new AppError('INTERNAL_ERROR', undefined, { cause: err });
}

// Express recognizes error middleware by its 4-argument signature.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    // Too late to send a JSON error; let Express close the connection.
    return next(err);
  }

  const appError = toAppError(err);
  res.locals.errorCode = appError.code;
  // Field names and rule messages only (never the submitted values), so a
  // 400/422 can be diagnosed from the logs without leaking passwords.
  res.locals.errorDetails = appError.details;

  if (appError.status >= SERVER_ERROR_STATUS) {
    // Full error (with stack and the original cause) goes to the log only.
    req.log.error({ err }, 'Request failed');
  }

  const body = { success: false, error: { code: appError.code, message: appError.message } };
  if (appError.details !== undefined) {
    body.error.details = appError.details;
  }
  return res.status(appError.status).json(body);
}

module.exports = errorHandler;

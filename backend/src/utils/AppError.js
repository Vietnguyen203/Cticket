const { ERROR_CODES } = require('./errorCodes');

/**
 * An expected, client-facing error. Anything that is NOT an AppError is treated
 * as a bug and reported to the client as a generic INTERNAL_ERROR.
 */
class AppError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES} code
   * @param {string} [message]  client-safe message; defaults to the catalog message
   * @param {{ details?: unknown, cause?: unknown }} [options]
   */
  constructor(code, message, { details, cause } = {}) {
    const definition = ERROR_CODES[code];
    if (!definition) {
      throw new Error(`Unknown error code: ${code}`);
    }
    super(message ?? definition.message, { cause });
    this.name = 'AppError';
    this.code = code;
    this.status = definition.status;
    this.details = details;
  }
}

module.exports = AppError;

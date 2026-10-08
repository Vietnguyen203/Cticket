const AppError = require('../utils/AppError');

const REQUEST_PARTS = ['params', 'query', 'body'];

/**
 * Validate request parts with zod schemas and expose the PARSED values on
 * `req.valid` (trimmed, lower-cased, unknown keys stripped).
 *
 * Parsed values are stored on req.valid rather than written back because in
 * Express 5 `req.query` is a read-only getter.
 *
 * Error details list the field and the rule, never the submitted value, so
 * passwords cannot end up in a response or a log.
 *
 * @param {{ params?: import('zod').ZodType, query?: import('zod').ZodType, body?: import('zod').ZodType }} schemas
 */
function validate(schemas) {
  return (req, res, next) => {
    req.valid = {};
    for (const part of REQUEST_PARTS) {
      if (!schemas[part]) continue;

      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field: [part, ...issue.path].join('.'),
          message: issue.message,
        }));
        throw new AppError('VALIDATION_ERROR', undefined, { details });
      }
      req.valid[part] = result.data;
    }
    next();
  };
}

module.exports = validate;

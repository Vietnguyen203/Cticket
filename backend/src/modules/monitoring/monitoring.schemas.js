const { z } = require('zod');
const { MONITORING } = require('../../config/constants');

// Text from the browser: trimmed, cut to a size, control characters removed (log / mail injection).
const text = (max) =>
  z
    .string()
    .transform((value) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max));

/** A JavaScript error reported by the web. The page is kept without its query string or hash. */
const clientError = z.object({
  message: text(500).pipe(z.string().min(1)),
  stack: text(4000).optional(),
  page: z
    .string()
    .max(2000)
    .transform((value) => value.split(/[?#]/)[0].slice(0, 300))
    .pipe(z.string().regex(/^\/[^\s]*$/, 'must be a path of this site')),
  browser: text(300).optional(),
  release: text(50).optional(),
});

const seriesQuery = z.object({
  minutes: z.coerce.number().int().min(5).max(24 * 60).default(60),
});

const clientErrorsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MONITORING.HISTORY_MAX).default(50),
});

module.exports = { clientError, seriesQuery, clientErrorsQuery };

const { z } = require('zod');

/** ISO 8601 with an explicit offset ("2026-12-20T19:30:00+07:00" or "...Z"), parsed to a Date. */
const isoDateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/** http(s) only: a "javascript:" URL stored here would become XSS in any client that renders it. */
const httpUrl = z.url({ protocol: /^https?$/ }).max(2000);

const nonEmptyPatch = (schema) =>
  schema.refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

module.exports = { isoDateTime, httpUrl, nonEmptyPatch };

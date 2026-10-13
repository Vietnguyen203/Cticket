const { z } = require('zod');

/** ISO 8601 with an explicit offset ("2026-12-20T19:30:00+07:00" or "...Z"), parsed to a Date. */
const isoDateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/** http(s) only: a "javascript:" URL stored here would become XSS in any client that renders it. */
const httpUrl = z.url({ protocol: /^https?$/ }).max(2000);
/** An image: a web address, or a file uploaded to this API (modules/uploads). */
const imageUrl = z.union([httpUrl, z.string().regex(/^\/api\/v1\/uploads\/images\/[0-9a-f-]{36}\.(jpg|png|webp)$/)]);

const MAX_PERSON_NAME_LENGTH = 100;
/** First or last name of a person (users table: varchar(100)). */
const personName = z.string().trim().min(1).max(MAX_PERSON_NAME_LENGTH);
const phoneNumber = z.string().trim().regex(/^\+?\d{8,15}$/, 'must be 8-15 digits, optionally starting with +');

const nonEmptyPatch = (schema) =>
  schema.refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

module.exports = { isoDateTime, httpUrl, imageUrl, nonEmptyPatch, personName, phoneNumber };

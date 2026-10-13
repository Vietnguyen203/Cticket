const { z } = require('zod');
const { VENUE_STATUS } = require('../../config/constants');
const { paginationQuery } = require('../../utils/pagination');

const DEFAULT_COUNTRY = 'Vietnam';

const fields = {
  name: z.string().trim().min(1).max(255),
  addressLine: z.string().trim().min(1).max(500),
  city: z.string().trim().min(1).max(100),
  province: z.string().trim().max(100).nullable(),
  country: z.string().trim().min(1).max(100),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  capacity: z.number().int().positive().nullable(),
  status: z.enum(Object.values(VENUE_STATUS)),
};

const idParams = z.object({ id: z.uuid() });

const listQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  includeInactive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  // Venue managers only (ignored for others): e.g. PENDING proposals to review.
  status: z.enum(Object.values(VENUE_STATUS)).optional(),
  ...paginationQuery,
});

const createVenue = z.object({
  name: fields.name,
  addressLine: fields.addressLine,
  city: fields.city,
  province: fields.province.optional(),
  country: fields.country.default(DEFAULT_COUNTRY),
  latitude: fields.latitude.optional(),
  longitude: fields.longitude.optional(),
  capacity: fields.capacity.optional(),
});

const updateVenue = z
  .object(Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, schema.optional()])))
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

module.exports = { idParams, listQuery, createVenue, updateVenue };

const { z } = require('zod');
const { ZONE_KIND, INVENTORY_LIMITS } = require('../../config/constants');

const SEAT_TYPES = ['STANDARD', 'VIP', 'ACCESSIBLE', 'COMPANION'];
const MAX_SEAT_NUMBER = 999;

const idParams = z.object({ id: z.uuid() });
const venueIdParams = z.object({ venueId: z.uuid() });

const createZone = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, 'must be 1-20 letters, digits, "-" or "_"'),
    name: z.string().trim().min(1).max(100),
    kind: z.enum(Object.values(ZONE_KIND)).default(ZONE_KIND.SEATED),
    capacity: z.number().int().positive().nullable().optional(),
  })
  .refine((zone) => zone.kind !== ZONE_KIND.STANDING || zone.capacity, {
    message: 'a STANDING zone needs a capacity',
    path: ['capacity'],
  });

const updateZone = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    capacity: z.number().int().positive().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

const seatRow = z
  .object({
    rowLabel: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,5}$/, 'must be 1-5 letters or digits'),
    from: z.number().int().min(1).max(MAX_SEAT_NUMBER),
    to: z.number().int().min(1).max(MAX_SEAT_NUMBER),
    seatType: z.enum(SEAT_TYPES).default('STANDARD'),
  })
  .refine((row) => row.to >= row.from, { message: 'to must be >= from', path: ['to'] });

const createSeats = z
  .object({
    rows: z.array(seatRow).min(1),
    layout: z
      .object({
        originX: z.number().default(0),
        originY: z.number().default(0),
        spacing: z.number().positive().default(INVENTORY_LIMITS.SEAT_SPACING),
      })
      .optional(),
  })
  .refine(
    ({ rows }) => rows.reduce((total, row) => total + (row.to - row.from + 1), 0) <= INVENTORY_LIMITS.MAX_SEATS_PER_BULK_CREATE,
    { message: `at most ${INVENTORY_LIMITS.MAX_SEATS_PER_BULK_CREATE} seats per request`, path: ['rows'] },
  );

module.exports = { idParams, venueIdParams, createZone, updateZone, createSeats };

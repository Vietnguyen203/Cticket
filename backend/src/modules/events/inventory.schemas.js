const { z } = require('zod');
const { INVENTORY_MODE, TICKET_TYPE_STATUS } = require('../../config/constants');
const { nonEmptyPatch } = require('../../utils/schemas');

const MAX_PRICE = 1_000_000_000_000; // integer VND
const MAX_CAPACITY = 1_000_000;
const MAX_SEATS_PER_ASSIGNMENT = 5000;
const MAX_ASSIGNMENTS = 200;
const MAX_SEATS_PER_BLOCK = 500;

const idParams = z.object({ id: z.uuid() });

const fields = {
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,50}$/, 'must be letters, digits, "-" or "_"'),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable(),
  price: z.number().int().min(0).max(MAX_PRICE),
  capacity: z.number().int().positive().max(MAX_CAPACITY),
  venueZoneId: z.uuid().nullable(),
  maxPerOrder: z.number().int().min(1).max(50),
  sortOrder: z.number().int().min(0).max(1000),
};

const createTicketType = z
  .object({
    code: fields.code,
    name: fields.name,
    description: fields.description.optional(),
    price: fields.price,
    currency: z.string().regex(/^[A-Z]{3}$/).default('VND'),
    inventoryMode: z.enum(Object.values(INVENTORY_MODE)),
    capacity: fields.capacity.optional(),
    venueZoneId: fields.venueZoneId.optional(),
    maxPerOrder: fields.maxPerOrder.optional(),
    sortOrder: fields.sortOrder.default(0),
  })
  .superRefine((body, ctx) => {
    const isGa = body.inventoryMode === INVENTORY_MODE.GENERAL_ADMISSION;
    if (isGa && !body.capacity) {
      ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'general admission needs a capacity' });
    }
    // Standing tickets are sold through a STANDING zone of the venue: where the people stand, and the
    // zone's capacity caps what all its ticket types sell together (ticket-types.service.js).
    if (isGa && !body.venueZoneId) {
      ctx.addIssue({ code: 'custom', path: ['venueZoneId'], message: 'general admission needs a STANDING zone of the venue' });
    }
    if (!isGa && body.capacity !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'reserved tickets get their size from the seat plan' });
    }
    if (!isGa && body.venueZoneId) {
      ctx.addIssue({ code: 'custom', path: ['venueZoneId'], message: 'reserved tickets are assigned seats, not a zone' });
    }
  });

// inventoryMode is fixed at creation: switching it would orphan seats or counters.
const updateTicketType = nonEmptyPatch(
  z.object({
    code: fields.code.optional(),
    name: fields.name.optional(),
    description: fields.description.optional(),
    price: fields.price.optional(),
    capacity: fields.capacity.nullable().optional(),
    venueZoneId: fields.venueZoneId.optional(),
    maxPerOrder: fields.maxPerOrder.optional(),
    sortOrder: fields.sortOrder.optional(),
    status: z.enum([TICKET_TYPE_STATUS.ACTIVE, TICKET_TYPE_STATUS.INACTIVE]).optional(),
  }),
);

const seatPlan = z.object({
  assignments: z
    .array(
      z
        .object({
          ticketTypeId: z.uuid(),
          seatIds: z.array(z.uuid()).min(1).max(MAX_SEATS_PER_ASSIGNMENT).optional(),
          zoneId: z.uuid().optional(),
          rows: z.array(z.string().trim().toUpperCase().min(1).max(5)).min(1).optional(),
        })
        .refine((a) => a.seatIds || a.zoneId, { message: 'select seats with seatIds or zoneId' })
        .refine((a) => !a.rows || a.zoneId, { message: 'rows needs a zoneId', path: ['rows'] }),
    )
    .max(MAX_ASSIGNMENTS),
});

const blockInventory = z
  .object({
    action: z.enum(['BLOCK', 'UNBLOCK']),
    reason: z.string().trim().min(3).max(500),
    seatIds: z.array(z.uuid()).min(1).max(MAX_SEATS_PER_BLOCK).optional(),
    ticketTypeId: z.uuid().optional(),
    quantity: z.number().int().positive().max(MAX_CAPACITY).optional(),
  })
  .refine((b) => Boolean(b.seatIds) !== Boolean(b.ticketTypeId && b.quantity), {
    message: 'send either seatIds (reserved seats) or ticketTypeId + quantity (general admission)',
  });

module.exports = { idParams, createTicketType, updateTicketType, seatPlan, blockInventory };

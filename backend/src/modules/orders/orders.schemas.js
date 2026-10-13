const { z } = require('zod');
const { ORDER_STATUS, ORDER_LIMITS } = require('../../config/constants');
const { paginationQuery } = require('../../utils/pagination');

const MAX = ORDER_LIMITS.MAX_TICKETS_PER_ORDER;

const idParams = z.object({ id: z.uuid() });

const createOrder = z
  .object({
    // Physical seat ids, as returned by the seat map (seats[].seatId).
    seatIds: z.array(z.uuid()).min(1).max(MAX).optional(),
    items: z
      .array(z.object({ ticketTypeId: z.uuid(), quantity: z.number().int().min(1).max(MAX) }))
      .min(1)
      .max(MAX)
      .optional(),
  })
  .refine((body) => body.seatIds || body.items, { message: 'send seatIds and/or items' })
  .refine((body) => !body.seatIds || new Set(body.seatIds).size === body.seatIds.length, {
    message: 'a seat can be listed only once',
    path: ['seatIds'],
  })
  .refine((body) => !body.items || new Set(body.items.map((i) => i.ticketTypeId)).size === body.items.length, {
    message: 'one entry per ticket type',
    path: ['items'],
  });

const listQuery = z.object({
  ...paginationQuery,
  all: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
  scheduleId: z.uuid().optional(),
  status: z.enum(Object.values(ORDER_STATUS)).optional(),
  // all=true only: order code (or its beginning) or buyer email
  q: z.string().trim().min(2).max(255).optional(),
});

const checkout = z.object({
  promotionCode: z.string().trim().min(3).max(50).optional(),
});

module.exports = { idParams, createOrder, listQuery, checkout };

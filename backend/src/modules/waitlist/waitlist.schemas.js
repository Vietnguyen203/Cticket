const { z } = require('zod');
const { ORDER_LIMITS } = require('../../config/constants');

const idParams = z.object({ id: z.uuid() });

// The per-type limit (max_per_order) is checked by the service.
const join = z.object({
  ticketTypeId: z.uuid(),
  quantity: z.number().int().min(1).max(ORDER_LIMITS.MAX_TICKETS_PER_ORDER),
});

module.exports = { idParams, join };

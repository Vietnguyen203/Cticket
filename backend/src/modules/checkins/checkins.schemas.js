const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const idParams = z.object({ id: z.uuid() });

// The shape of the QR is checked by the service (signature included): any
// malformed scan becomes QR_INVALID, never a validation error.
const checkIn = z.object({
  qrToken: z.string().trim().min(1).max(200),
  scheduleId: z.uuid(),
  deviceId: z.string().trim().min(1).max(100).optional(),
});

const listQuery = z.object({ ...paginationQuery });

module.exports = { idParams, checkIn, listQuery };

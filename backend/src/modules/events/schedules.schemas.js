const { z } = require('zod');
const { SCHEDULE_STATUS } = require('../../config/constants');
const { isoDateTime, nonEmptyPatch } = require('../../utils/schemas');

const eventIdParams = z.object({ eventId: z.uuid() });
const idParams = z.object({ id: z.uuid() });

const createSchedule = z.object({
  venueId: z.uuid(),
  startAt: isoDateTime,
  endAt: isoDateTime,
  salesStartAt: isoDateTime.optional(),
  salesEndAt: isoDateTime.optional(),
  capacity: z.number().int().min(1).max(1_000_000).optional(),
});

const updateSchedule = nonEmptyPatch(
  z.object({
    venueId: z.uuid().optional(),
    startAt: isoDateTime.optional(),
    endAt: isoDateTime.optional(),
    salesStartAt: isoDateTime.optional(),
    salesEndAt: isoDateTime.optional(),
    // Total attendance planned: the seated and standing tiers must fit in it.
    capacity: z.number().int().min(1).max(1_000_000).nullable().optional(),
    status: z.literal(SCHEDULE_STATUS.CANCELLED).optional(),
  }),
);

module.exports = { eventIdParams, idParams, createSchedule, updateSchedule };

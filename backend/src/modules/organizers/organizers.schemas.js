const { z } = require('zod');
const { ORGANIZER_STATUS } = require('../../config/constants');
const { paginationQuery } = require('../../utils/pagination');

// Vietnamese tax codes: 10 digits, or 10 digits + "-" + 3 digits for branches.
const TAX_CODE_PATTERN = /^\d{10}(-\d{3})?$/;

const idParams = z.object({ id: z.uuid() });

const apply = z.object({
  organizationName: z.string().trim().min(2).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  taxCode: z.string().trim().regex(TAX_CODE_PATTERN, 'must be 10 digits, or 10 digits-3 digits').nullable().optional(),
});

const listQuery = z.object({
  status: z.enum(Object.values(ORGANIZER_STATUS)).optional(),
  ...paginationQuery,
});

const changeStatus = z.object({
  status: z.enum([ORGANIZER_STATUS.ACTIVE, ORGANIZER_STATUS.REJECTED, ORGANIZER_STATUS.SUSPENDED]),
  reason: z.string().trim().min(3).max(1000).optional(),
});

module.exports = { idParams, apply, listQuery, changeStatus };

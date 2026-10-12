const { z } = require('zod');
const { TICKET_STATUS } = require('../../config/constants');
const { paginationQuery } = require('../../utils/pagination');

const idParams = z.object({ id: z.uuid() });

const listQuery = z.object({
  ...paginationQuery,
  status: z.enum(Object.values(TICKET_STATUS)).optional(),
});

module.exports = { idParams, listQuery };

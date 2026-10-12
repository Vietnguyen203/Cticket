const { z } = require('zod');
const { paginationQuery } = require('../../utils/pagination');

const idParams = z.object({ id: z.uuid() });

const listQuery = z.object({
  ...paginationQuery,
  unread: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
});

module.exports = { idParams, listQuery };

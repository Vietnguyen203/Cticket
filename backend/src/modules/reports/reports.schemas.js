const { z } = require('zod');

const idParams = z.object({ id: z.uuid() });

/** Vietnamese calendar days "YYYY-MM-DD"; order, future and length are checked by the service. */
const salesQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
});

module.exports = { idParams, salesQuery };

const { z } = require('zod');

const eventIdParams = z.object({ id: z.uuid() });
const staffParams = z.object({ id: z.uuid(), userId: z.uuid() });
const MAX_EMAIL_LENGTH = 255;

// Same normalisation as sign-up (auth.schemas): trimmed and lower-cased before the format check.
const assignStaff = z.object({ email: z.string().trim().toLowerCase().max(MAX_EMAIL_LENGTH).pipe(z.email()) });

module.exports = { eventIdParams, staffParams, assignStaff };

const { z } = require('zod');
const { REVIEW, REVIEW_STATUS } = require('../../config/constants');
const { paginationQuery } = require('../../utils/pagination');
const { SORTS } = require('./reviews.repository');

const idParams = z.object({ id: z.uuid() });
const idOrSlugParams = z.object({ idOrSlug: z.string().min(1).max(320) });
const stars = z.coerce.number().int().min(1).max(5);

// No links: reviews are not an advertising board (spam).
const LINK = /(https?:\/\/|www\.)/i;
const text = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !LINK.test(value), { message: 'links are not allowed' });

const listQuery = z.object({
  sort: z.enum(Object.keys(SORTS)).default('newest'),
  rating: stars.optional(),
  ...paginationQuery,
});

const saveReview = z.object({
  rating: z.number().int().min(1).max(5),
  comment: text(REVIEW.MAX_COMMENT)
    .transform((value) => value || null)
    .nullable()
    .optional(),
});

const reply = z.object({ reply: text(REVIEW.MAX_REPLY).pipe(z.string().min(1)) });

const adminListQuery = z.object({
  eventId: z.uuid().optional(),
  rating: stars.optional(),
  status: z.enum(Object.values(REVIEW_STATUS)).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  ...paginationQuery,
});

const hide = z.object({ reason: z.string().trim().min(3).max(500) });

module.exports = { idParams, idOrSlugParams, listQuery, saveReview, reply, adminListQuery, hide };

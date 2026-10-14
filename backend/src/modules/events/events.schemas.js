const { z } = require('zod');
const { EVENT_STATUS, EVENT_LIMITS } = require('../../config/constants');
const { paginationQuery } = require('../../utils/pagination');
const { isoDateTime, imageUrl, nonEmptyPatch } = require('../../utils/schemas');
const { SORT_ORDERS } = require('./events.repository');

const MAX_DESCRIPTION_LENGTH = 20_000;

const fields = {
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable(),
  bannerUrl: imageUrl.nullable(),
  thumbnailUrl: imageUrl.nullable(),
  ageRestriction: z.number().int().min(0).max(99).nullable(),
  categoryIds: z
    .array(z.uuid())
    .min(1)
    .max(EVENT_LIMITS.MAX_CATEGORIES)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'must not contain duplicates' }),
};

const idParams = z.object({ id: z.uuid() });
const idOrSlugParams = z.object({ idOrSlug: z.string().min(1).max(320) });

const createEvent = z.object({
  title: fields.title,
  description: fields.description.optional(),
  bannerUrl: fields.bannerUrl.optional(),
  thumbnailUrl: fields.thumbnailUrl.optional(),
  ageRestriction: fields.ageRestriction.optional(),
  categoryIds: fields.categoryIds,
});

const updateEvent = nonEmptyPatch(
  z.object(Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, schema.optional()]))),
);

// FINISHED is set by the system, never requested by a client.
const changeStatus = z.object({
  status: z.enum([EVENT_STATUS.PENDING_APPROVAL, EVENT_STATUS.PUBLISHED, EVENT_STATUS.DRAFT, EVENT_STATUS.CANCELLED]),
  reason: z.string().trim().min(3).max(1000).optional(),
});

const listQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  categoryId: z.uuid().optional(),
  city: z.string().trim().min(1).max(100).optional(),
  dateFrom: isoDateTime.optional(),
  dateTo: isoDateTime.optional(),
  status: z.enum(Object.values(EVENT_STATUS)).optional(),
  mine: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sort: z.enum(Object.keys(SORT_ORDERS)).optional(),
  ...paginationQuery,
});

/** DELETE /events/:id: the title, typed again, for anything but an empty draft. A missing body is an empty one. */
const deleteEvent = z.object({ confirmTitle: z.string().max(300).optional() }).optional().default({});

module.exports = { idParams, idOrSlugParams, createEvent, updateEvent, changeStatus, listQuery, deleteEvent };

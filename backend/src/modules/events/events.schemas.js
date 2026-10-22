const { z } = require('zod');
const { EVENT_STATUS, EVENT_LIMITS, REFUND_POLICY, PURCHASE_QUEUE } = require('../../config/constants');
const { paginationQuery } = require('../../utils/pagination');
const { isoDateTime, imageUrl, nonEmptyPatch } = require('../../utils/schemas');
const { SORT_ORDERS } = require('./events.repository');

const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_LINEUP_ITEMS = 50; // also a CHECK in the database
const TIME_24 = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One line of the performance programme: who, an optional planned time (24-hour), a note. */
const lineupItem = z
  .object({
    artist: z.string().trim().min(1).max(120),
    time: z.string().trim().regex(TIME_24, 'must be a 24-hour time HH:mm (00:00 to 23:59)').nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .strict()
  .transform(({ artist, time, note }) => ({ artist, time: time || null, note: note || null }));

const fields = {
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable(),
  bannerUrl: imageUrl.nullable(),
  thumbnailUrl: imageUrl.nullable(),
  ageRestriction: z.number().int().min(0).max(99).nullable(),
  refundPolicy: z.enum(Object.values(REFUND_POLICY)), // Phase 18.3
  // Phase 21: purchase queue (changed with PATCH only; a new event starts without it)
  queueEnabled: z.boolean(),
  queueCapacity: z.number().int().min(1).max(PURCHASE_QUEUE.MAX_CAPACITY),
  queueSessionMinutes: z.number().int().min(PURCHASE_QUEUE.MIN_SESSION_MINUTES).max(PURCHASE_QUEUE.MAX_SESSION_MINUTES),
  // The performance programme, in order (changed with PATCH only, also while on sale).
  lineup: z.array(lineupItem).max(MAX_LINEUP_ITEMS),
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
  refundPolicy: fields.refundPolicy.optional(),
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
  // Admins: events of every status, newest first (the "Tất cả" tab of the admin events list).
  all: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  sort: z.enum(Object.keys(SORT_ORDERS)).optional(),
  ...paginationQuery,
});

/** DELETE /events/:id: the title, typed again, for anything but an empty draft. A missing body is an empty one. */
const deleteEvent = z.object({ confirmTitle: z.string().max(300).optional() }).optional().default({});

module.exports = { idParams, idOrSlugParams, createEvent, updateEvent, changeStatus, listQuery, deleteEvent };

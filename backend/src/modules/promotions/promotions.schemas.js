const { z } = require('zod');
const { isoDateTime, nonEmptyPatch } = require('../../utils/schemas');
const { paginationQuery } = require('../../utils/pagination');
const { DISCOUNT_TYPE, PROMOTION_STATUS } = require('../../config/constants');

const MAX_AMOUNT = 1_000_000_000_000; // VND
const MAX_USES = 1_000_000;
const MAX_PERCENT = 100;

const amount = z.number().int().min(0).max(MAX_AMOUNT);
const uses = z.number().int().positive().max(MAX_USES);
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,50}$/, 'must be 3-50 letters, digits, "-" or "_"');

const fields = {
  name: z.string().trim().min(1).max(150),
  discountType: z.enum(Object.values(DISCOUNT_TYPE)),
  discountValue: z.number().int().positive().max(MAX_AMOUNT),
  maxDiscount: amount.positive().nullable(),
  minOrderAmount: amount,
  usageLimit: uses.nullable(),
  perUserLimit: uses.nullable(),
  startsAt: isoDateTime,
  expiresAt: isoDateTime,
  status: z.enum(Object.values(PROMOTION_STATUS)),
};

// The same rules as the database CHECKs, reported per field.
const percentageAtMost100 = (body) => body.discountType !== DISCOUNT_TYPE.PERCENTAGE || body.discountValue <= MAX_PERCENT;
const periodInOrder = (body) => !body.startsAt || !body.expiresAt || body.startsAt < body.expiresAt;

const idParams = z.object({ id: z.uuid() });

const createPromotion = z
  .object({
    code,
    name: fields.name,
    discountType: fields.discountType,
    discountValue: fields.discountValue,
    maxDiscount: fields.maxDiscount.optional(),
    minOrderAmount: fields.minOrderAmount.default(0),
    usageLimit: fields.usageLimit.optional(),
    perUserLimit: fields.perUserLimit.optional(),
    startsAt: fields.startsAt,
    expiresAt: fields.expiresAt,
    status: fields.status.default(PROMOTION_STATUS.ACTIVE),
  })
  .refine(percentageAtMost100, { message: `a percentage is at most ${MAX_PERCENT}`, path: ['discountValue'] })
  .refine(periodInOrder, { message: 'must be after startsAt', path: ['expiresAt'] });

const updatePromotion = nonEmptyPatch(
  z.object({
    name: fields.name.optional(),
    discountType: fields.discountType.optional(),
    discountValue: fields.discountValue.optional(),
    maxDiscount: fields.maxDiscount.optional(),
    minOrderAmount: fields.minOrderAmount.optional(),
    usageLimit: fields.usageLimit.optional(),
    perUserLimit: fields.perUserLimit.optional(),
    startsAt: fields.startsAt.optional(),
    expiresAt: fields.expiresAt.optional(),
    status: fields.status.optional(),
  }),
);

const listQuery = z.object({ ...paginationQuery, status: fields.status.optional() });

const validatePromotion = z.object({ code, orderId: z.uuid() });

module.exports = { idParams, createPromotion, updatePromotion, listQuery, validatePromotion };

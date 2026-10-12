const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { DISCOUNT_TYPE, PROMOTION_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const promotionsRepository = require('./promotions.repository');

function toPromotion(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    maxDiscount: row.max_discount,
    minOrderAmount: row.min_order_amount,
    usageLimit: row.usage_limit,
    usedCount: row.used_count,
    perUserLimit: row.per_user_limit,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Discount in VND (integer), always computed here, never taken from the client. */
function discountFor(promotion, subtotal) {
  if (promotion.discount_type === DISCOUNT_TYPE.PERCENTAGE) {
    const discount = Math.floor((subtotal * promotion.discount_value) / 100);
    return promotion.max_discount === null ? discount : Math.min(discount, promotion.max_discount);
  }
  return Math.min(promotion.discount_value, subtotal);
}

/**
 * Why a code cannot be used for this order, or null if it can.
 * @returns {Promise<string|null>} NOT_FOUND | INACTIVE | NOT_STARTED | EXPIRED | MIN_ORDER_AMOUNT | USAGE_LIMIT | PER_USER_LIMIT
 */
async function refusal(db, promotion, { subtotal, userId }, now = new Date()) {
  if (!promotion) return 'NOT_FOUND';
  if (promotion.status !== PROMOTION_STATUS.ACTIVE) return 'INACTIVE';
  if (now < promotion.starts_at) return 'NOT_STARTED';
  if (now >= promotion.expires_at) return 'EXPIRED';
  if (subtotal < promotion.min_order_amount) return 'MIN_ORDER_AMOUNT';
  if (promotion.usage_limit !== null && promotion.used_count >= promotion.usage_limit) return 'USAGE_LIMIT';
  if (
    promotion.per_user_limit !== null &&
    (await promotionsRepository.countUsesByUser(db, promotion.id, userId)) >= promotion.per_user_limit
  ) {
    return 'PER_USER_LIMIT';
  }
  return null;
}

const invalid = (reason) => new AppError('PROMOTION_INVALID', undefined, { details: { reason } });
const normalizeCode = (code) => code.trim().toUpperCase();

/** PRO-01: what a code would do to an order, without using it up. */
async function preview({ code, subtotal, userId }) {
  const promotion = await promotionsRepository.findByCode(pool, normalizeCode(code));
  const reason = await refusal(pool, promotion, { subtotal, userId });
  if (reason) throw invalid(reason);
  const discount = discountFor(promotion, subtotal);
  return { code: promotion.code, name: promotion.name, discountAmount: discount, totalAmount: subtotal - discount };
}

/**
 * Checkout, inside the order's transaction: check the code and TAKE one use
 * now, so the customer pays the price they were shown. The promotion row is
 * locked, which serializes every checkout with this code: with one use left,
 * exactly one of two concurrent buyers gets it (PRO-03).
 * @returns {Promise<{ promotionId: string, discount: number }>}
 */
async function useForOrder(client, { code, orderId, subtotal, userId }) {
  const promotion = await promotionsRepository.findByCode(client, normalizeCode(code), { forUpdate: true });
  const reason = await refusal(client, promotion, { subtotal, userId });
  if (reason) throw invalid(reason);
  if (!(await promotionsRepository.takeUse(client, promotion.id))) throw invalid('USAGE_LIMIT');

  const discount = discountFor(promotion, subtotal);
  await promotionsRepository.insertUsage(client, { promotionId: promotion.id, userId, orderId, discountAmount: discount });
  return { promotionId: promotion.id, discount };
}

/** An unpaid order ended (cancelled / expired): its use goes back to the code. */
function returnUsesOfOrder(client, orderId) {
  return promotionsRepository.returnUsesOfOrder(client, orderId);
}

// ---------------------------------------------------------------------------
// Admin (PRO-02)
// ---------------------------------------------------------------------------

async function createPromotion(body) {
  return toPromotion(await promotionsRepository.insert(pool, { ...body, code: normalizeCode(body.code) }));
}

/** The kind and size of a discount cannot change once someone has used the code. */
async function updatePromotion(id, changes) {
  return withTransaction(async (client) => {
    const current = await promotionsRepository.findById(client, id, { forUpdate: true });
    if (!current) throw new AppError('NOT_FOUND', 'Promotion not found.');
    if (current.used_count > 0 && (changes.discountType !== undefined || changes.discountValue !== undefined)) {
      throw new AppError('INVALID_STATE_TRANSITION', 'The discount of a code that has been used cannot change.');
    }
    return toPromotion(await promotionsRepository.update(client, id, changes));
  });
}

async function listPromotions({ status, page, pageSize }) {
  const { rows, total } = await promotionsRepository.list(pool, { status, ...toLimitOffset({ page, pageSize }) });
  return { promotions: rows.map(toPromotion), meta: toPageMeta({ page, pageSize }, total) };
}

module.exports = { preview, useForOrder, returnUsesOfOrder, createPromotion, updatePromotion, listPromotions, discountFor };

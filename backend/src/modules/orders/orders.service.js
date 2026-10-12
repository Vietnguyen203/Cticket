const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { PG_ERROR } = require('../../database/errors');
const env = require('../../config/env');
const {
  EVENT_STATUS,
  SCHEDULE_STATUS,
  INVENTORY_MODE,
  TICKET_TYPE_STATUS,
  SEAT_STATUS,
  ORDER_STATUS,
  ACTIVE_ORDER_STATUSES,
  CANCEL_REASON,
  ORDER_LIMITS,
} = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const { recordAudit } = require('../audit');
const events = require('../events');
const promotions = require('../promotions');
const ordersRepository = require('./orders.repository');
const { releaseHeldOrder, expireOrder, expireDueOrders } = require('./order-release');
const { generateOrderCode } = require('./order-code');
const fastPath = require('./fast-path');
const { markOrderPaid } = require('./order-payment');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, scheduleRoom, seatUpdate, inventoryUpdate } = require('../../realtime/messages');

const ACTIVE_CART_CONSTRAINT = 'uq_orders_active_cart';
const ORDER_CODE_CONSTRAINT = 'orders_order_code_key';
const SECONDS_PER_MINUTE = 60;

const orderNotFound = () => new AppError('NOT_FOUND', 'Order not found.');
const isUniqueViolation = (err, constraint) => err.code === PG_ERROR.UNIQUE_VIOLATION && err.constraint === constraint;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toOrderItem(row) {
  return {
    id: row.id,
    ticketTypeId: row.ticket_type_id,
    ticketTypeName: row.ticket_type_name,
    seatId: row.seat_id,
    seatLabel: row.seat_label,
    unitPrice: row.unit_price,
    quantity: row.quantity,
    totalAmount: row.total_amount,
  };
}

function toPayment(row) {
  return {
    id: row.id,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    provider: row.provider,
    failureCode: row.failure_code,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

function toOrder(row, items, payments) {
  return {
    id: row.id,
    orderCode: row.order_code,
    status: row.status,
    event: { id: row.event_id, title: row.event_title, slug: row.event_slug },
    schedule: { id: row.schedule_id, startAt: row.start_at, venueName: row.venue_name },
    items: items.map(toOrderItem),
    subtotal: row.subtotal,
    discountAmount: row.discount_amount,
    totalAmount: row.total_amount,
    currency: row.currency,
    expiresAt: row.expires_at,
    remainingSeconds: row.remaining_seconds,
    checkedOutAt: row.checked_out_at,
    paidAt: row.paid_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    ...(payments ? { payments: payments.map(toPayment) } : {}),
  };
}

async function loadOrder(db, orderId) {
  const row = await ordersRepository.findDetail(db, orderId);
  const [items, payments] = await Promise.all([
    ordersRepository.listItems(db, [orderId]),
    ordersRepository.listPayments(db, orderId),
  ]);
  return toOrder(row, items, payments);
}

const canSee = (actor, order) => order.user_id === actor.userId || actor.canManageAll;

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

/** The schedule must be on sale right now. Hidden (unpublished) events are reported as 404. */
function assertOnSale(sale, now = new Date()) {
  if (!sale || !events.PUBLIC_STATUSES.includes(sale.event.status)) {
    throw new AppError('NOT_FOUND', 'Schedule not found.');
  }
  const { event, schedule } = sale;
  if (event.status !== EVENT_STATUS.PUBLISHED || schedule.status !== SCHEDULE_STATUS.SCHEDULED) {
    throw new AppError('SALES_CLOSED');
  }
  if (!schedule.inventory_generated_at) throw new AppError('INVENTORY_NOT_GENERATED');
  if (now < schedule.sales_start_at) throw new AppError('SALES_NOT_OPEN');
  if (now >= schedule.sales_end_at) throw new AppError('SALES_CLOSED');
}

/** GA lines: each ticket type must be an ACTIVE general admission type of this schedule. */
function resolveGaItems(items, ticketTypes) {
  const byId = new Map(ticketTypes.map((tt) => [tt.id, tt]));
  const problems = [];
  const resolved = items.map((item, index) => {
    const ticketType = byId.get(item.ticketTypeId);
    let message = null;
    if (!ticketType) message = 'is not a ticket type of this schedule';
    else if (ticketType.inventory_mode !== INVENTORY_MODE.GENERAL_ADMISSION) message = 'is a reserved-seat type: send seatIds';
    else if (ticketType.status !== TICKET_TYPE_STATUS.ACTIVE) message = 'is not on sale';
    if (message) problems.push({ field: `body.items.${index}.ticketTypeId`, message });
    return { ticketType, quantity: item.quantity };
  });
  if (problems.length > 0) throw new AppError('TICKET_TYPE_UNAVAILABLE', undefined, { details: problems });
  // ga_inventory rows are locked in ticket_type_id order.
  return resolved.sort((a, b) => (a.ticketType.id < b.ticketType.id ? -1 : 1));
}

/** Lock the requested seats (seat_id order) and check every one of them can be held. All or nothing. */
async function lockRequestedSeats(client, scheduleId, seatIds) {
  const locked = await events.lockSeatsForHold(client, scheduleId, [...seatIds].sort());
  const bySeatId = new Map(locked.map((row) => [row.seat_id, row]));

  const unavailable = seatIds
    .filter((id) => bySeatId.get(id)?.status !== SEAT_STATUS.AVAILABLE)
    .map((id) => ({ seatId: id, status: bySeatId.get(id)?.status ?? 'NOT_IN_INVENTORY' }));
  if (unavailable.length > 0) throw new AppError('SEATS_UNAVAILABLE', undefined, { details: unavailable });

  const paused = locked.filter((row) => row.ticket_type_status !== TICKET_TYPE_STATUS.ACTIVE);
  if (paused.length > 0) {
    throw new AppError('TICKET_TYPE_UNAVAILABLE', 'Some of these seats are not on sale.', {
      details: paused.map((row) => ({ field: 'body.seatIds', message: `${row.seat_id} is not on sale` })),
    });
  }
  return locked;
}

/** max_per_order of each ticket type (the overall cap is checked before any lock). */
function assertPerTypeLimits(seats, gaItems) {
  const perType = new Map();
  const count = (id, name, max, quantity) => {
    const entry = perType.get(id) ?? { name, max, quantity: 0 };
    entry.quantity += quantity;
    perType.set(id, entry);
  };
  seats.forEach((seat) => count(seat.ticket_type_id, seat.ticket_type_name, seat.max_per_order, 1));
  gaItems.forEach(({ ticketType, quantity }) => count(ticketType.id, ticketType.name, ticketType.max_per_order, quantity));

  const over = [...perType.values()].filter((entry) => entry.quantity > entry.max);
  if (over.length > 0) {
    throw new AppError('ORDER_LIMIT_EXCEEDED', undefined, {
      details: over.map((entry) => ({ field: 'body', message: `at most ${entry.max} tickets of "${entry.name}" per order` })),
    });
  }
}

/**
 * Tx 2 of a booking. Lock order: event, schedule (FOR SHARE) → the new order
 * row → seats (seat_id order) → GA counters (ticket_type_id order).
 *
 * The order row is inserted BEFORE touching inventory: if the same customer
 * double-clicks, the second request waits on uq_orders_active_cart and then
 * fails with ACTIVE_ORDER_EXISTS, without ever competing for the seats.
 */
function placeOrder(actor, scheduleId, { seatIds = [], items = [] }) {
  return withTransaction(async (client) => {
    const sale = await events.lockScheduleForSale(client, scheduleId);
    assertOnSale(sale);
    const { event } = sale;
    const gaItems = resolveGaItems(items, await events.listTicketTypes(client, scheduleId));

    const order = await ordersRepository.insertHeldOrder(client, {
      orderCode: generateOrderCode(),
      userId: actor.userId,
      scheduleId,
      ttlSeconds: env.HOLD_TTL_MINUTES * SECONDS_PER_MINUTE,
    });

    const seats = seatIds.length > 0 ? await lockRequestedSeats(client, scheduleId, seatIds) : [];
    assertPerTypeLimits(seats, gaItems);

    const heldSeats =
      seats.length > 0 ? await events.holdSeats(client, { scheduleId, seatIds, orderId: order.id, expiresAt: order.expires_at }) : [];
    if (heldSeats.length !== seats.length) throw new Error('Locked seats changed status inside the booking transaction');
    const counters = [];
    for (const { ticketType, quantity } of gaItems) {
      const counter = await events.holdGa(client, { ticketTypeId: ticketType.id, quantity });
      if (!counter) {
        const error = new AppError('INSUFFICIENT_INVENTORY', `Not enough "${ticketType.name}" tickets left.`, {
          details: [{ field: 'body.items', message: `${ticketType.id} has fewer than ${quantity} left` }],
        });
        error.gaLeft = { ticketTypeId: ticketType.id, left: await events.gaAvailable(client, ticketType.id) };
        throw error;
      }
      counters.push(counter);
    }

    // Prices are snapshots: a later change to the ticket type never changes this order.
    const lines = [
      ...seats.map((seat) => ({
        scheduleSeatId: seat.schedule_seat_id,
        seatId: seat.seat_id,
        seatLabel: `${seat.zone_name} - ${seat.seat_code}`,
        ticketTypeId: seat.ticket_type_id,
        ticketTypeName: seat.ticket_type_name,
        unitPrice: seat.price,
        quantity: 1,
      })),
      ...gaItems.map(({ ticketType, quantity }) => ({
        ticketTypeId: ticketType.id,
        ticketTypeName: ticketType.name,
        unitPrice: ticketType.price,
        quantity,
      })),
    ];
    await ordersRepository.insertItems(client, { orderId: order.id, eventId: event.id, scheduleId }, lines);
    await ordersRepository.recalculateTotals(client, order.id);

    // Live seat maps update once this commits (never for a rolled-back attempt).
    const room = scheduleRoom(scheduleId);
    if (heldSeats.length > 0) publishAfterCommit(client, room, seatUpdate(MESSAGE.SEAT_HELD, scheduleId, heldSeats));
    if (counters.length > 0) publishAfterCommit(client, room, inventoryUpdate(scheduleId, counters));
    return loadOrder(client, order.id);
  });
}

async function activeOrderExists(userId, scheduleId, cause) {
  const active = await ordersRepository.findActiveForUser(pool, { userId, scheduleId });
  return new AppError('ACTIVE_ORDER_EXISTS', undefined, {
    details: active ? { orderId: active.id } : undefined,
    cause,
  });
}

/**
 * Hold seats and/or GA tickets of one schedule for `HOLD_TTL_MINUTES`.
 *
 * 1. Redis fast path: short seat locks and the GA "sold out" hint reject
 *    requests that cannot succeed, without using a PostgreSQL connection.
 * 2. Tx 1 expires holds of this schedule whose time is already up, so a seat
 *    that the seat map shows as free (its hold expired) can be booked now
 *    instead of after the next sweep.
 * 3. Tx 2 (placeOrder) decides, exactly as without Redis.
 */
async function createOrder(context, actor, scheduleId, body) {
  const ticketCount = (body.seatIds?.length ?? 0) + (body.items ?? []).reduce((sum, item) => sum + item.quantity, 0);
  if (ticketCount > ORDER_LIMITS.MAX_TICKETS_PER_ORDER) {
    throw new AppError('ORDER_LIMIT_EXCEEDED', `At most ${ORDER_LIMITS.MAX_TICKETS_PER_ORDER} tickets per order.`);
  }

  // Redis fast path (Phase 6): refuse early what PostgreSQL would refuse anyway.
  await fastPath.assertGaHint(body.items ?? []);
  const releaseSeatLocks = await fastPath.lockSeats(scheduleId, body.seatIds ?? []);
  try {
    await expireDueOrders({ scheduleId });
    // Fast path for the common case; uq_orders_active_cart is the real guard.
    if (await ordersRepository.findActiveForUser(pool, { userId: actor.userId, scheduleId })) {
      throw await activeOrderExists(actor.userId, scheduleId);
    }
    return await placeOrder(actor, scheduleId, body);
  } catch (err) {
    if (isUniqueViolation(err, ACTIVE_CART_CONSTRAINT)) {
      throw await activeOrderExists(actor.userId, scheduleId, err);
    }
    // A random order code collided (about 1 in a billion per day): try once more.
    if (isUniqueViolation(err, ORDER_CODE_CONSTRAINT)) {
      return placeOrder(actor, scheduleId, body);
    }
    if (err.gaLeft) {
      await fastPath.rememberGaLeft(err.gaLeft.ticketTypeId, err.gaLeft.left);
    }
    throw err;
  } finally {
    await releaseSeatLocks();
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** A HELD order past its time is expired on read, so the customer never sees a dead timer. */
async function getOrder(actor, orderId) {
  const order = await ordersRepository.findById(pool, orderId);
  if (!order || !canSee(actor, order)) throw orderNotFound();
  if (order.hold_expired) await expireOrder(orderId);
  return loadOrder(pool, orderId);
}

/** Own orders by default; `all=true` (order:manage) lists everyone's. */
async function listOrders(actor, { all, scheduleId, status, page, pageSize }) {
  if (all && !actor.canManageAll) {
    throw new AppError('FORBIDDEN', 'Only administrators can list all orders.');
  }
  if (!all) await expireDueOrders({ userId: actor.userId });

  const { rows, total } = await ordersRepository.list(pool, {
    userId: all ? null : actor.userId,
    scheduleId,
    status,
    ...toLimitOffset({ page, pageSize }),
  });
  const items = rows.length > 0 ? await ordersRepository.listItems(pool, rows.map((row) => row.id)) : [];
  return {
    orders: rows.map((row) => toOrder(row, items.filter((item) => item.order_id === row.id))),
    meta: toPageMeta({ page, pageSize }, total),
  };
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * The customer (or an admin) cancels a HELD order: the seats and GA tickets
 * go back on sale immediately. If the order turns out to be past its time,
 * it is expired instead (and that is committed) before reporting ORDER_EXPIRED.
 */
async function cancelOrder(context, actor, orderId) {
  const outcome = await withTransaction(async (client) => {
    const order = await ordersRepository.findById(client, orderId, { forUpdate: true });
    if (!order || !canSee(actor, order)) throw orderNotFound();
    if (!ACTIVE_ORDER_STATUSES.includes(order.status)) {
      throw new AppError('INVALID_STATE_TRANSITION', `Cannot cancel an order that is ${order.status}.`);
    }
    if (order.hold_expired) {
      await releaseHeldOrder(client, orderId, { to: ORDER_STATUS.EXPIRED });
      return 'EXPIRED';
    }

    const byOwner = order.user_id === actor.userId;
    await releaseHeldOrder(client, orderId, {
      to: ORDER_STATUS.CANCELLED,
      cancelReason: byOwner ? CANCEL_REASON.USER_CANCELLED : CANCEL_REASON.ADMIN_CANCELLED,
    });
    if (!byOwner) {
      await recordAudit(client, {
        context,
        action: 'ORDER_CANCELLED',
        entityType: 'order',
        entityId: orderId,
        oldValue: { status: order.status },
        newValue: { status: ORDER_STATUS.CANCELLED, reason: CANCEL_REASON.ADMIN_CANCELLED },
      });
    }
    return 'CANCELLED';
  });

  if (outcome === 'EXPIRED') throw new AppError('ORDER_EXPIRED');
  return loadOrder(pool, orderId);
}

// ---------------------------------------------------------------------------
// Checkout (ORD-03)
// ---------------------------------------------------------------------------

/**
 * HELD → PAYMENT_PENDING, once. Fixes the price (a promotion code is checked
 * and one use taken now), and extends the hold by the payment window.
 * Lock order: order → its seats → the promotion row, as in every order flow.
 * A 0đ order (100% discount) has nothing to pay and becomes PAID right away.
 */
async function checkoutOrder(context, actor, orderId, { promotionCode }) {
  const outcome = await withTransaction(async (client) => {
    const order = await ordersRepository.findById(client, orderId, { forUpdate: true });
    if (!order || order.user_id !== actor.userId) throw orderNotFound();
    if (order.status !== ORDER_STATUS.HELD) {
      throw new AppError('INVALID_STATE_TRANSITION', `Only a HELD order can be checked out; this one is ${order.status}.`);
    }
    if (order.hold_expired) {
      await releaseHeldOrder(client, orderId, { to: ORDER_STATUS.EXPIRED });
      return 'EXPIRED';
    }

    const windowSeconds = env.PAYMENT_WINDOW_MINUTES * SECONDS_PER_MINUTE;
    await events.extendHoldsOfOrder(client, orderId, windowSeconds);
    const { discount } = promotionCode
      ? await promotions.useForOrder(client, { code: promotionCode, orderId, subtotal: order.subtotal, userId: actor.userId })
      : { discount: 0 };
    const checkedOut = await ordersRepository.checkout(client, { orderId, discount, windowSeconds });
    if (checkedOut.total_amount === 0) await markOrderPaid(client, orderId);
    return 'CHECKED_OUT';
  });

  if (outcome === 'EXPIRED') throw new AppError('ORDER_EXPIRED');
  return loadOrder(pool, orderId);
}

/** PRO-01: preview a promotion code on one of my HELD orders, without using it. */
async function previewPromotion(actor, { orderId, code }) {
  const order = await ordersRepository.findById(pool, orderId);
  if (!order || order.user_id !== actor.userId) throw orderNotFound();
  return { orderId, subtotal: order.subtotal, ...(await promotions.preview({ code, subtotal: order.subtotal, userId: actor.userId })) };
}

module.exports = { createOrder, getOrder, listOrders, cancelOrder, checkoutOrder, previewPromotion };

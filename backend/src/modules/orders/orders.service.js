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
const { QUEUE, enqueueAfterCommit } = require('../../queue/queues');
const { publishAfterCommit } = require('../../realtime/publisher');
const { MESSAGE, scheduleRoom, userRoom, seatUpdate, inventoryUpdate } = require('../../realtime/messages');

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

function toTicket(row) {
  return {
    id: row.id,
    code: row.ticket_code,
    seatLabel: row.seat_label,
    ticketTypeName: row.ticket_type_name,
    admissionNo: row.admission_no,
    status: row.status,
    issuedAt: row.issued_at,
  };
}

function toOrder(row, items, payments, tickets) {
  return {
    id: row.id,
    orderCode: row.order_code,
    status: row.status,
    buyerEmail: row.buyer_email,
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
    ...(tickets ? { tickets: tickets.map(toTicket) } : {}),
  };
}

async function loadOrder(db, orderId) {
  const row = await ordersRepository.findDetail(db, orderId);
  // One after another: `db` may be a transaction client, which runs one query at a time
  // (overlapping calls are deprecated in pg and removed in pg@9).
  const items = await ordersRepository.listItems(db, [orderId]);
  const payments = await ordersRepository.listPayments(db, orderId);
  const tickets = await ordersRepository.listTickets(db, orderId);
  return toOrder(row, items, payments, tickets);
}

const canSee = (actor, order) => order.user_id === actor.userId || actor.canManageAll;

/**
 * Q-03: expire the order exactly at its deadline. One job per deadline (the
 * id includes it): checkout schedules a new one, and the earlier job then
 * finds the order not yet due and does nothing (expireOrder only expires
 * orders whose expires_at has passed). The worker's sweep is the safety net.
 */
function scheduleExpiry(client, orderId, expiresAt) {
  const deadline = new Date(expiresAt).getTime();
  enqueueAfterCommit(
    client,
    QUEUE.HOLDS,
    'expire',
    { orderId },
    { jobId: `expire-${orderId}-${deadline}`, delay: Math.max(0, deadline - Date.now()) },
  );
}

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

/** Every seat of `seatIds` can be held: AVAILABLE, of a ticket type on sale. All or nothing. */
function assertHoldable(lockedRows, seatIds) {
  const bySeatId = new Map(lockedRows.map((row) => [row.seat_id, row]));

  const unavailable = seatIds
    .filter((id) => bySeatId.get(id)?.status !== SEAT_STATUS.AVAILABLE)
    .map((id) => ({ seatId: id, status: bySeatId.get(id)?.status ?? 'NOT_IN_INVENTORY' }));
  if (unavailable.length > 0) throw new AppError('SEATS_UNAVAILABLE', undefined, { details: unavailable });

  const paused = seatIds.map((id) => bySeatId.get(id)).filter((row) => row.ticket_type_status !== TICKET_TYPE_STATUS.ACTIVE);
  if (paused.length > 0) {
    throw new AppError('TICKET_TYPE_UNAVAILABLE', 'Some of these seats are not on sale.', {
      details: paused.map((row) => ({ field: 'body.seatIds', message: `${row.seat_id} is not on sale` })),
    });
  }
}

/** Lock the requested seats (seat_id order) and check every one of them can be held. */
async function lockRequestedSeats(client, scheduleId, seatIds) {
  const locked = await events.lockSeatsForHold(client, scheduleId, [...seatIds].sort());
  assertHoldable(locked, seatIds);
  return locked;
}

// Order lines. Prices are snapshots: a later change to the ticket type never changes the order.
const seatLine = (seat) => ({
  scheduleSeatId: seat.schedule_seat_id,
  seatId: seat.seat_id,
  seatLabel: `${seat.zone_name} - ${seat.seat_code}`,
  ticketTypeId: seat.ticket_type_id,
  ticketTypeName: seat.ticket_type_name,
  unitPrice: seat.price,
  quantity: 1,
});
const gaLine = (ticketType, quantity) => ({
  ticketTypeId: ticketType.id,
  ticketTypeName: ticketType.name,
  unitPrice: ticketType.price,
  quantity,
});

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
      seats.length > 0 ? await events.holdSeats(client, { scheduleId, seatIds, orderId: order.id }) : [];
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

    const lines = [...seats.map(seatLine), ...gaItems.map(({ ticketType, quantity }) => gaLine(ticketType, quantity))];
    await ordersRepository.insertItems(client, { orderId: order.id, eventId: event.id, scheduleId }, lines);
    await ordersRepository.recalculateTotals(client, order.id);
    scheduleExpiry(client, order.id, order.expires_at);

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
  await fastPath.assertSeatHints(scheduleId, body.seatIds ?? []);
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
    if (err.code === 'SEATS_UNAVAILABLE' && Array.isArray(err.details)) {
      await fastPath.rememberTakenSeats(scheduleId, err.details);
    }
    throw err;
  } finally {
    await releaseSeatLocks();
  }
}

// ---------------------------------------------------------------------------
// Editing a held order (BKG-02)
// ---------------------------------------------------------------------------

/** What an order holds (or should hold): physical seat ids, and GA quantities per ticket type. */
function contentOfLines(lines) {
  return {
    seatIds: lines.filter((line) => line.seat_id).map((line) => line.seat_id),
    ga: new Map(lines.filter((line) => !line.seat_id).map((line) => [line.ticket_type_id, line.quantity])),
  };
}

const contentOfBody = ({ seatIds = [], items = [] }) => ({
  seatIds,
  ga: new Map(items.map((item) => [item.ticketTypeId, item.quantity])),
});

/** The whole new content: at least one ticket (else cancel), at most MAX_TICKETS_PER_ORDER. */
function assertTicketCount(content) {
  const count = content.seatIds.length + [...content.ga.values()].reduce((sum, quantity) => sum + quantity, 0);
  if (count === 0) throw new AppError('ORDER_CANNOT_BE_EMPTY');
  if (count > ORDER_LIMITS.MAX_TICKETS_PER_ORDER) {
    throw new AppError('ORDER_LIMIT_EXCEEDED', `At most ${ORDER_LIMITS.MAX_TICKETS_PER_ORDER} tickets per order.`);
  }
  return content;
}

/** From what the order holds to what is wanted. GA changes come in ticket_type_id order (their lock order). */
function diffContent(current, wanted) {
  const addSeatIds = wanted.seatIds.filter((id) => !current.seatIds.includes(id));
  const removeSeatIds = current.seatIds.filter((id) => !wanted.seatIds.includes(id));
  const gaChanges = [...new Set([...current.ga.keys(), ...wanted.ga.keys()])]
    .sort()
    .map((ticketTypeId) => ({ ticketTypeId, from: current.ga.get(ticketTypeId) ?? 0, to: wanted.ga.get(ticketTypeId) ?? 0 }))
    .filter((change) => change.from !== change.to);
  const gaAdded = gaChanges
    .filter((change) => change.to > change.from)
    .map((change) => ({ ticketTypeId: change.ticketTypeId, quantity: change.to - change.from }));
  return {
    addSeatIds,
    removeSeatIds,
    gaChanges,
    gaAdded,
    adds: addSeatIds.length > 0 || gaAdded.length > 0,
    none: addSeatIds.length + removeSeatIds.length + gaChanges.length === 0,
  };
}

function assertEditable(order) {
  if (order.status === ORDER_STATUS.EXPIRED) throw new AppError('ORDER_EXPIRED');
  if (order.status !== ORDER_STATUS.HELD) {
    throw new AppError('INVALID_STATE_TRANSITION', `Only a HELD order can be changed; this one is ${order.status}.`);
  }
}

/** GA tickets being added: a general admission type of this schedule, on sale. Taking tickets out is always allowed. */
function assertGaAddable(gaAdded, ticketTypesById) {
  const problems = gaAdded.flatMap(({ ticketTypeId }) => {
    const ticketType = ticketTypesById.get(ticketTypeId);
    let message = null;
    if (!ticketType) message = 'is not a ticket type of this schedule';
    else if (ticketType.inventory_mode !== INVENTORY_MODE.GENERAL_ADMISSION) message = 'is a reserved-seat type: send seatIds';
    else if (ticketType.status !== TICKET_TYPE_STATUS.ACTIVE) message = 'is not on sale';
    return message ? [{ field: 'body.items', message: `${ticketTypeId} ${message}` }] : [];
  });
  if (problems.length > 0) throw new AppError('TICKET_TYPE_UNAVAILABLE', undefined, { details: problems });
}

/**
 * max_per_order of the ticket types this edit adds to. A type the edit only
 * keeps or reduces is never refused, even if its limit was lowered since.
 */
function assertPerTypeLimitsAfterEdit(before, after, ticketTypesById) {
  const over = [...after]
    .filter(([id, quantity]) => quantity > (before.get(id) ?? 0) && quantity > ticketTypesById.get(id).max_per_order)
    .map(([id]) => ticketTypesById.get(id));
  if (over.length > 0) {
    throw new AppError('ORDER_LIMIT_EXCEEDED', undefined, {
      details: over.map((tt) => ({ field: 'body', message: `at most ${tt.max_per_order} tickets of "${tt.name}" per order` })),
    });
  }
}

function countPerType(seatTicketTypeIds, ga) {
  const counts = new Map(ga);
  seatTicketTypeIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  return counts;
}

/**
 * The transaction of an edit. Lock order as in booking: event, schedule (FOR
 * SHARE) → the order row → the seats added AND removed, in one seat_id-ordered
 * pass (two customers swapping seats queue up instead of deadlocking) → GA
 * counters (ticket_type_id order). Everything is recomputed from the locked
 * rows: the caller's preview only fed the Redis fast path.
 * @returns {Promise<'EXPIRED'|'UNCHANGED'|'UPDATED'>}
 */
function applyEdit(actor, { id: orderId, schedule_id: scheduleId }, wantedOf) {
  return withTransaction(async (client) => {
    const sale = await events.lockScheduleForSale(client, scheduleId);
    const order = await ordersRepository.findById(client, orderId, { forUpdate: true });
    assertEditable(order);
    if (order.hold_expired) {
      await releaseHeldOrder(client, orderId, { to: ORDER_STATUS.EXPIRED });
      return 'EXPIRED';
    }

    const lines = await ordersRepository.listItems(client, [orderId]);
    const current = contentOfLines(lines);
    const wanted = wantedOf(current);
    const diff = diffContent(current, wanted);
    if (diff.none) return 'UNCHANGED';
    if (diff.adds) assertOnSale(sale);

    const ticketTypesById = new Map((await events.listTicketTypes(client, scheduleId)).map((tt) => [tt.id, tt]));
    const seats = await events.lockSeatsForHold(client, scheduleId, [...diff.addSeatIds, ...diff.removeSeatIds].sort());
    const added = seats.filter((seat) => diff.addSeatIds.includes(seat.seat_id));
    assertHoldable(seats, diff.addSeatIds);
    assertGaAddable(diff.gaAdded, ticketTypesById);
    assertPerTypeLimitsAfterEdit(
      countPerType(lines.filter((line) => line.seat_id).map((line) => line.ticket_type_id), current.ga),
      countPerType(
        [
          ...lines.filter((line) => wanted.seatIds.includes(line.seat_id)).map((line) => line.ticket_type_id),
          ...added.map((seat) => seat.ticket_type_id),
        ],
        wanted.ga,
      ),
      ticketTypesById,
    );

    const room = scheduleRoom(scheduleId);
    if (diff.removeSeatIds.length > 0) {
      const released = await events.releaseSeats(client, { scheduleId, seatIds: diff.removeSeatIds, orderId });
      if (released.length !== diff.removeSeatIds.length) throw new Error(`Seats of order ${orderId} are not held by it`);
      await ordersRepository.deleteSeatLines(client, orderId, diff.removeSeatIds);
      fastPath.forgetTakenSeatsAfterCommit(client, scheduleId, diff.removeSeatIds);
      publishAfterCommit(client, room, seatUpdate(MESSAGE.SEAT_RELEASED, scheduleId, released));
    }
    if (added.length > 0) {
      // Same deadline as the rest of the order: an edit never extends the hold.
      const held = await events.holdSeats(client, { scheduleId, seatIds: diff.addSeatIds, orderId });
      if (held.length !== added.length) throw new Error('Locked seats changed status inside the edit transaction');
      await ordersRepository.insertItems(client, { orderId, eventId: sale.event.id, scheduleId }, added.map(seatLine));
      publishAfterCommit(client, room, seatUpdate(MESSAGE.SEAT_HELD, scheduleId, held));
    }

    const counters = [];
    for (const { ticketTypeId, from, to } of diff.gaChanges) {
      const ticketType = ticketTypesById.get(ticketTypeId);
      const counter =
        to > from
          ? await events.holdGa(client, { ticketTypeId, quantity: to - from })
          : await events.releaseGa(client, { ticketTypeId, quantity: from - to });
      if (!counter && to > from) {
        const error = new AppError('INSUFFICIENT_INVENTORY', `Not enough "${ticketType.name}" tickets left.`, {
          details: [{ field: 'body.items', message: `${ticketTypeId} has fewer than ${to - from} left` }],
        });
        error.gaLeft = { ticketTypeId, left: await events.gaAvailable(client, ticketTypeId) };
        throw error;
      }
      if (!counter) throw new Error(`GA counter of ticket type ${ticketTypeId} is lower than the quantity being released`);
      counters.push(counter);
      if (from === 0) {
        const line = gaLine(ticketType, to);
        await ordersRepository.insertItems(client, { orderId, eventId: sale.event.id, scheduleId }, [line]);
      } else {
        await ordersRepository.setGaLineQuantity(client, { orderId, ticketTypeId, quantity: to });
      }
    }
    if (counters.length > 0) publishAfterCommit(client, room, inventoryUpdate(scheduleId, counters));

    await ordersRepository.recalculateTotals(client, orderId);
    // Another tab showing this order reloads it.
    publishAfterCommit(client, userRoom(actor.userId), { type: MESSAGE.ORDER_UPDATED, orderId });
    return 'UPDATED';
  });
}

/**
 * Preview from an unlocked read, only to send what is being ADDED through the
 * Redis fast path (as a booking does); then the transaction decides.
 */
async function editOrder(actor, orderId, wantedOf) {
  const order = await ordersRepository.findById(pool, orderId);
  if (!order || order.user_id !== actor.userId) throw orderNotFound();
  assertEditable(order);
  const checkedWantedOf = (current) => assertTicketCount(wantedOf(current));
  const current = contentOfLines(await ordersRepository.listItems(pool, [orderId]));
  const preview = diffContent(current, checkedWantedOf(current));

  await fastPath.assertGaHint(preview.gaAdded);
  await fastPath.assertSeatHints(order.schedule_id, preview.addSeatIds);
  const releaseSeatLocks = await fastPath.lockSeats(order.schedule_id, preview.addSeatIds);
  try {
    // BKG-05: holds of this schedule already past their time stop blocking the seats being added.
    if (preview.adds) await expireDueOrders({ scheduleId: order.schedule_id });
    const outcome = await applyEdit(actor, order, checkedWantedOf);
    if (outcome === 'EXPIRED') throw new AppError('ORDER_EXPIRED');
    return await loadOrder(pool, orderId);
  } catch (err) {
    if (err.gaLeft) await fastPath.rememberGaLeft(err.gaLeft.ticketTypeId, err.gaLeft.left);
    if (err.code === 'SEATS_UNAVAILABLE' && Array.isArray(err.details)) {
      await fastPath.rememberTakenSeats(order.schedule_id, err.details);
    }
    throw err;
  } finally {
    await releaseSeatLocks();
  }
}

/**
 * BKG-02: change what one of my HELD orders holds. `body` is the WHOLE new
 * content, as when booking, so sending the same request twice changes nothing
 * the second time. Seats taken out are on sale again once this commits; the
 * hold's deadline does not move.
 */
function updateOrderItems(context, actor, orderId, body) {
  const wanted = contentOfBody(body);
  return editOrder(actor, orderId, () => wanted);
}

/** BKG-02 as in the requirements sheet: take one seat out of my HELD order. */
function removeSeat(context, actor, orderId, seatId) {
  return editOrder(actor, orderId, (current) => {
    if (!current.seatIds.includes(seatId)) throw new AppError('NOT_FOUND', 'This seat is not in the order.');
    return { seatIds: current.seatIds.filter((id) => id !== seatId), ga: current.ga };
  });
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
async function listOrders(actor, { all, scheduleId, status, q, page, pageSize }) {
  if (all && !actor.canManageAll) {
    throw new AppError('FORBIDDEN', 'Only administrators can list all orders.');
  }
  if (!all) await expireDueOrders({ userId: actor.userId });

  const { rows, total } = await ordersRepository.list(pool, {
    userId: all ? null : actor.userId,
    scheduleId,
    status,
    q: all ? q : undefined,
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
    else scheduleExpiry(client, orderId, checkedOut.expires_at);
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

module.exports = {
  createOrder,
  updateOrderItems,
  removeSeat,
  getOrder,
  listOrders,
  cancelOrder,
  checkoutOrder,
  previewPromotion,
};

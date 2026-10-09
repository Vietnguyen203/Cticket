const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory, changeStatus } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, cancelOrder, makeDue } = require('../helpers/orders');
const { expireDueOrders } = require('../../src/modules/orders/order-release');
const { findInventoryMismatches } = require('../../src/modules/orders');

const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizer;
let category;

beforeAll(async () => {
  admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  category = await createCategory(app, admin.token);
});
afterAll(() => closePool());

/** A PUBLISHED event: CAT1 = seats A01..A10, CAT2 = B01..B10, STAND = 100 GA. */
async function onSale(options = {}) {
  const world = await createConfiguredEvent(app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
    ...options,
  });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  const seat = Object.fromEntries(world.seats.map((s) => [s.code, s.id]));
  return { ...world, seat };
}

async function availability(scheduleId) {
  const res = await request(app).get(`/api/v1/schedules/${scheduleId}/availability`).expect(200);
  return Object.fromEntries(res.body.data.ticketTypes.map((t) => [t.code, t.available]));
}

async function gaCounters(ticketTypeId) {
  const { rows } = await query(
    `SELECT held_quantity, sold_quantity, blocked_quantity FROM ga_inventory WHERE ticket_type_id = $1`,
    [ticketTypeId],
  );
  return rows[0];
}

const orderStatus = async (orderId) =>
  (await query(`SELECT status, cancel_reason FROM orders WHERE id = $1`, [orderId])).rows[0];

// Every test ends with stock that matches the orders exactly.
afterEach(async () => {
  expect(await findInventoryMismatches(pool)).toEqual([]);
});

describe('holding tickets', () => {
  test('one order can hold seats and GA tickets; prices are snapshotted and summed by the database', async () => {
    const { schedule, seat, standing } = await onSale();
    const [buyer] = await createCustomers(1);

    const res = await book(app, buyer.token, schedule.id, {
      seatIds: [seat.A01, seat.B05],
      items: [{ ticketTypeId: standing.id, quantity: 2 }],
    }).expect(201);
    const { order } = res.body.data;

    expect(order).toMatchObject({
      status: 'HELD',
      subtotal: 2_000_000 + 1_000_000 + 2 * 500_000,
      discountAmount: 0,
      totalAmount: 4_000_000,
      currency: 'VND',
    });
    expect(order.orderCode).toMatch(/^ETP-\d{6}-[A-HJ-NP-Z2-9]{6}$/);
    expect(order.remainingSeconds).toBeGreaterThan(590);
    expect(order.remainingSeconds).toBeLessThanOrEqual(600);
    expect(order.items).toEqual([
      expect.objectContaining({ seatLabel: 'Khu A - A01', unitPrice: 2_000_000, quantity: 1, totalAmount: 2_000_000 }),
      expect.objectContaining({ seatLabel: 'Khu A - B05', unitPrice: 1_000_000, quantity: 1 }),
      expect.objectContaining({ seatLabel: null, ticketTypeName: 'Standing', unitPrice: 500_000, quantity: 2, totalAmount: 1_000_000 }),
    ]);

    expect(await availability(schedule.id)).toEqual({ CAT1: 9, CAT2: 9, STAND: 98 });
    const map = await request(app).get(`/api/v1/schedules/${schedule.id}/seat-map`);
    const a01 = map.body.data.zones.find((z) => z.code === 'A').seats.find((s) => s.code === 'A01');
    expect(a01.status).toBe('HELD');
  });

  test('one open order per customer and schedule: the second gets the first one back', async () => {
    const { schedule, seat } = await onSale();
    const [buyer] = await createCustomers(1);
    const first = await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] }).expect(201);

    const second = await book(app, buyer.token, schedule.id, { seatIds: [seat.A02] });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'ACTIVE_ORDER_EXISTS',
      details: { orderId: first.body.data.order.id },
    });
  });

  test('rejected requests hold nothing at all', async () => {
    const { schedule, seat, cat1, cat2, standing } = await onSale({ cat1MaxPerOrder: 2 });
    const other = await onSale();
    const [buyer] = await createCustomers(1);
    await request(app)
      .post(`/api/v1/schedules/${schedule.id}/inventory/block`)
      .set(bearer(organizer.token))
      .send({ action: 'BLOCK', reason: 'Camera', seatIds: [seat.A10] })
      .expect(200);
    const attempt = (body) => book(app, buyer.token, schedule.id, body);

    // A free seat plus a blocked one: nothing is held, and the client learns which seat failed.
    const blocked = await attempt({ seatIds: [seat.A01, seat.A10] });
    expect(blocked.body.error).toMatchObject({ code: 'SEATS_UNAVAILABLE', details: [{ seatId: seat.A10, status: 'BLOCKED' }] });

    const foreign = await attempt({ seatIds: [other.seat.A01] });
    expect(foreign.body.error.details).toEqual([{ seatId: other.seat.A01, status: 'NOT_IN_INVENTORY' }]);

    expect((await attempt({ items: [{ ticketTypeId: cat2.id, quantity: 1 }] })).body.error.code).toBe('TICKET_TYPE_UNAVAILABLE');
    expect((await attempt({ items: [{ ticketTypeId: other.standing.id, quantity: 1 }] })).body.error.code).toBe(
      'TICKET_TYPE_UNAVAILABLE',
    );
    expect((await attempt({ seatIds: [seat.A01, seat.A02, seat.A03] })).body.error.code).toBe('ORDER_LIMIT_EXCEEDED');
    expect((await attempt({ items: [{ ticketTypeId: standing.id, quantity: 6 }], seatIds: [seat.B01, seat.B02, seat.B03, seat.B04, seat.B05] })).body.error.code).toBe('ORDER_LIMIT_EXCEEDED');
    expect((await attempt({ seatIds: [seat.A01, seat.A01] })).status).toBe(400);

    // Paused ticket type: its seats cannot be held.
    await request(app).patch(`/api/v1/ticket-types/${cat1.id}`).set(bearer(organizer.token)).send({ status: 'INACTIVE' }).expect(200);
    expect((await attempt({ seatIds: [seat.A01] })).body.error.code).toBe('TICKET_TYPE_UNAVAILABLE');

    const { rows } = await query(`SELECT count(*)::int AS n FROM orders WHERE user_id = $1`, [buyer.id]);
    expect(rows[0].n).toBe(0);
    expect(await gaCounters(standing.id)).toMatchObject({ held_quantity: 0 });
  });

  test('sales window, unpublished events and anonymous callers', async () => {
    const { schedule, seat } = await onSale();
    const [buyer] = await createCustomers(1);

    await query(`UPDATE event_schedules SET sales_start_at = now() + interval '1 day' WHERE id = $1`, [schedule.id]);
    expect((await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] })).body.error.code).toBe('SALES_NOT_OPEN');

    await query(
      `UPDATE event_schedules SET sales_start_at = now() - interval '2 days', sales_end_at = now() - interval '1 day'
       WHERE id = $1`,
      [schedule.id],
    );
    expect((await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] })).body.error.code).toBe('SALES_CLOSED');

    const draft = await createConfiguredEvent(app, {
      adminToken: admin.token,
      organizerToken: organizer.token,
      categoryId: category.id,
    });
    expect((await book(app, buyer.token, draft.schedule.id, { seatIds: [draft.seats[0].id] })).status).toBe(404);
    await request(app).post(`/api/v1/schedules/${schedule.id}/orders`).send({ seatIds: [seat.A01] }).expect(401);
  });
});

describe('ending a hold', () => {
  test('cancel puts everything back; a second cancel and strangers are refused', async () => {
    const { schedule, seat, standing } = await onSale();
    const [buyer, stranger] = await createCustomers(2);
    const { order } = (
      await book(app, buyer.token, schedule.id, { seatIds: [seat.A01], items: [{ ticketTypeId: standing.id, quantity: 3 }] })
    ).body.data;

    expect((await request(app).get(`/api/v1/orders/${order.id}`).set(bearer(stranger.token))).status).toBe(404);
    expect((await cancelOrder(app, stranger.token, order.id)).status).toBe(404);

    const cancelled = await cancelOrder(app, buyer.token, order.id).expect(200);
    expect(cancelled.body.data.order).toMatchObject({ status: 'CANCELLED', cancelReason: 'USER_CANCELLED', remainingSeconds: null });
    expect(await availability(schedule.id)).toMatchObject({ CAT1: 10, STAND: 100 });

    expect((await cancelOrder(app, buyer.token, order.id)).body.error.code).toBe('INVALID_STATE_TRANSITION');
    // The customer can book again right away.
    await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] }).expect(201);
  });

  test('the sweeper expires due orders and returns their stock', async () => {
    const { schedule, seat, standing } = await onSale();
    const [buyer] = await createCustomers(1);
    const { order } = (
      await book(app, buyer.token, schedule.id, { seatIds: [seat.A01, seat.A02], items: [{ ticketTypeId: standing.id, quantity: 4 }] })
    ).body.data;

    await makeDue(order.id);
    expect(await expireDueOrders({ scheduleId: schedule.id })).toBe(1);
    expect(await orderStatus(order.id)).toEqual({ status: 'EXPIRED', cancel_reason: null });
    expect(await availability(schedule.id)).toMatchObject({ CAT1: 10, STAND: 100 });
    expect(await expireDueOrders({ scheduleId: schedule.id })).toBe(0);
  });

  test('a due order is expired lazily: on read, on cancel, and when someone books its seat', async () => {
    const { schedule, seat } = await onSale();
    const [first, second, third] = await createCustomers(3);

    const onRead = (await book(app, first.token, schedule.id, { seatIds: [seat.A01] })).body.data.order;
    await makeDue(onRead.id);
    const read = await request(app).get(`/api/v1/orders/${onRead.id}`).set(bearer(first.token)).expect(200);
    expect(read.body.data.order.status).toBe('EXPIRED');

    const onCancel = (await book(app, second.token, schedule.id, { seatIds: [seat.A02] })).body.data.order;
    await makeDue(onCancel.id);
    expect((await cancelOrder(app, second.token, onCancel.id)).body.error.code).toBe('ORDER_EXPIRED');
    expect((await orderStatus(onCancel.id)).status).toBe('EXPIRED'); // committed despite the error

    const onBooking = (await book(app, first.token, schedule.id, { seatIds: [seat.A03] })).body.data.order;
    await makeDue(onBooking.id);
    // No sweeper ran: the seat map already shows A03 free, and booking it works.
    await book(app, third.token, schedule.id, { seatIds: [seat.A03] }).expect(201);
    expect((await orderStatus(onBooking.id)).status).toBe('EXPIRED');
  });

  test('cancelling the event cancels its held orders in the same transaction', async () => {
    const { event, schedule, seat, standing } = await onSale();
    const [buyer] = await createCustomers(1);
    const { order } = (
      await book(app, buyer.token, schedule.id, { seatIds: [seat.B01], items: [{ ticketTypeId: standing.id, quantity: 1 }] })
    ).body.data;

    await changeStatus(app, organizer.token, event.id, 'CANCELLED', 'Artist is ill').expect(200);
    expect(await orderStatus(order.id)).toEqual({ status: 'CANCELLED', cancel_reason: 'EVENT_CANCELLED' });
    expect(await gaCounters(standing.id)).toMatchObject({ held_quantity: 0 });

    const { rows } = await query(
      `SELECT new_value FROM audit_logs WHERE entity_id = $1 AND action = 'EVENT_CANCELLED'`,
      [event.id],
    );
    expect(rows[0].new_value).toMatchObject({ heldOrdersCancelled: 1 });
  });

  test('cancelling one schedule cancels the held orders of that schedule', async () => {
    const { schedule, seat } = await onSale();
    const [buyer] = await createCustomers(1);
    const { order } = (await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] })).body.data;

    await request(app)
      .patch(`/api/v1/schedules/${schedule.id}`)
      .set(bearer(organizer.token))
      .send({ status: 'CANCELLED' })
      .expect(200);
    expect(await orderStatus(order.id)).toEqual({ status: 'CANCELLED', cancel_reason: 'SCHEDULE_CANCELLED' });
    expect((await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] })).body.error.code).toBe('SALES_CLOSED');
  });

  test('my orders vs. all orders', async () => {
    const { schedule, seat } = await onSale();
    const [buyer, other] = await createCustomers(2);
    await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] }).expect(201);
    await book(app, other.token, schedule.id, { seatIds: [seat.A02] }).expect(201);

    const mine = await request(app).get('/api/v1/orders').set(bearer(buyer.token)).expect(200);
    expect(mine.body.data.orders).toHaveLength(1);
    expect(mine.body.data.orders[0].items[0].seatLabel).toBe('Khu A - A01');
    expect(mine.body.data.orders[0].event.title).toBeTruthy();

    expect((await request(app).get('/api/v1/orders?all=true').set(bearer(buyer.token))).status).toBe(403);
    const all = await request(app)
      .get(`/api/v1/orders?all=true&scheduleId=${schedule.id}`)
      .set(bearer(admin.token))
      .expect(200);
    expect(all.body.meta.total).toBe(2);
  });
});

describe('inventory reconciliation', () => {
  test('reports counters and seats that disagree with the orders', async () => {
    const { schedule, seat, standing } = await onSale();
    const [buyer] = await createCustomers(1);
    const { order } = (
      await book(app, buyer.token, schedule.id, { seatIds: [seat.A01], items: [{ ticketTypeId: standing.id, quantity: 2 }] })
    ).body.data;

    // Simulate bugs: a GA counter off by one, and a seat freed behind the order's back.
    await query(`UPDATE ga_inventory SET held_quantity = held_quantity + 1 WHERE ticket_type_id = $1`, [standing.id]);
    await query(
      `UPDATE schedule_seats SET status = 'AVAILABLE', held_by_order_id = NULL, hold_expires_at = NULL
       WHERE held_by_order_id = $1`,
      [order.id],
    );
    const kinds = (await findInventoryMismatches(pool)).map((m) => m.kind).sort();
    expect(kinds).toEqual(['GA_COUNTER', 'ORDER_SEAT_NOT_HELD']);

    // Repair, so the afterEach check passes.
    await query(`UPDATE ga_inventory SET held_quantity = held_quantity - 1 WHERE ticket_type_id = $1`, [standing.id]);
    await query(
      `UPDATE schedule_seats s SET status = 'HELD', held_by_order_id = o.id, hold_expires_at = o.expires_at
       FROM orders o WHERE o.id = $1 AND s.schedule_id = o.schedule_id AND s.seat_id = $2`,
      [order.id, seat.A01],
    );
  });
});

describe('concurrency: the database alone prevents over-selling', () => {
  test('50 customers try to hold the same seat at once: exactly one gets it', async () => {
    const { schedule, seat } = await onSale();
    const buyers = await createCustomers(50);

    const results = await Promise.all(buyers.map((b) => book(app, b.token, schedule.id, { seatIds: [seat.A01] })));
    const codes = results.map((r) => (r.status === 201 ? 'OK' : r.body.error.code));
    expect(codes.filter((c) => c === 'OK')).toHaveLength(1);
    expect(codes.filter((c) => c === 'SEATS_UNAVAILABLE')).toHaveLength(49);
  });

  test('50 customers try to hold 1 GA ticket when 10 are left: exactly 10 succeed', async () => {
    const { schedule, standing } = await onSale();
    await request(app)
      .post(`/api/v1/schedules/${schedule.id}/inventory/block`)
      .set(bearer(organizer.token))
      .send({ action: 'BLOCK', reason: 'Sponsors', ticketTypeId: standing.id, quantity: 90 })
      .expect(200);
    const buyers = await createCustomers(50);

    const results = await Promise.all(
      buyers.map((b) => book(app, b.token, schedule.id, { items: [{ ticketTypeId: standing.id, quantity: 1 }] })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'INSUFFICIENT_INVENTORY')).toBe(true);
    expect(await gaCounters(standing.id)).toEqual({ held_quantity: 10, sold_quantity: 0, blocked_quantity: 90 });
  });

  test('crossing requests ([A, B] vs [B, A]) never deadlock: one wins each pair', async () => {
    const { schedule, seat } = await onSale();
    const buyers = await createCustomers(20);
    const pairs = [
      ['A01', 'A02'], ['A03', 'A04'], ['A05', 'A06'], ['A07', 'A08'], ['A09', 'A10'],
      ['B01', 'B02'], ['B03', 'B04'], ['B05', 'B06'], ['B07', 'B08'], ['B09', 'B10'],
    ];

    const results = await Promise.all(
      pairs.flatMap(([x, y], i) => [
        book(app, buyers[2 * i].token, schedule.id, { seatIds: [seat[x], seat[y]] }),
        book(app, buyers[2 * i + 1].token, schedule.id, { seatIds: [seat[y], seat[x]] }),
      ]),
    );
    expect(results.map((r) => r.status).sort()).toEqual([...Array(10).fill(201), ...Array(10).fill(409)]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'SEATS_UNAVAILABLE')).toBe(true);
  });

  test('one customer double-clicking 5 times gets one order', async () => {
    const { schedule, seat, standing } = await onSale();
    const [buyer] = await createCustomers(1);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        book(app, buyer.token, schedule.id, { seatIds: [seat.A01], items: [{ ticketTypeId: standing.id, quantity: 1 }] }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual(Array(4).fill('ACTIVE_ORDER_EXISTS'));
    expect(await gaCounters(standing.id)).toMatchObject({ held_quantity: 1 });
  });

  test('sweepers and a cancel racing on one due order release it exactly once', async () => {
    const { schedule, seat, standing } = await onSale();
    const [buyer] = await createCustomers(1);
    const { order } = (
      await book(app, buyer.token, schedule.id, { seatIds: [seat.A01], items: [{ ticketTypeId: standing.id, quantity: 5 }] })
    ).body.data;
    await makeDue(order.id);

    const [sweepA, sweepB, cancel] = await Promise.all([
      expireDueOrders({ scheduleId: schedule.id }),
      expireDueOrders({ scheduleId: schedule.id }),
      cancelOrder(app, buyer.token, order.id),
    ]);
    // Whoever got the lock first expired it; nobody released it twice.
    const expiredBySweepers = sweepA + sweepB;
    expect(expiredBySweepers).toBeLessThanOrEqual(1);
    expect(cancel.body.error.code).toBe(expiredBySweepers === 1 ? 'INVALID_STATE_TRANSITION' : 'ORDER_EXPIRED');
    expect((await orderStatus(order.id)).status).toBe('EXPIRED');
    expect(await gaCounters(standing.id)).toMatchObject({ held_quantity: 0 });
  });

  test('two sweepers over 20 due orders expire each one exactly once', async () => {
    const { schedule, standing } = await onSale();
    const buyers = await createCustomers(20);
    const orders = await Promise.all(
      buyers.map(async (b) => (await book(app, b.token, schedule.id, { items: [{ ticketTypeId: standing.id, quantity: 2 }] })).body.data.order),
    );
    await Promise.all(orders.map((o) => makeDue(o.id)));

    const [a, b] = await Promise.all([expireDueOrders({ scheduleId: schedule.id }), expireDueOrders({ scheduleId: schedule.id })]);
    expect(a + b).toBe(20);
    expect(await gaCounters(standing.id)).toMatchObject({ held_quantity: 0 });
  });
});

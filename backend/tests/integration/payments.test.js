const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory, changeStatus } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, cancelOrder, makeDue } = require('../helpers/orders');
const { startServer, connect } = require('../helpers/ws');
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
afterEach(async () => {
  expect(await findInventoryMismatches(pool)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** PUBLISHED event: CAT1 = A01..A10 (2.000.000đ), CAT2 = B01..B10, STAND = 100 GA (500.000đ). */
async function onSale() {
  const world = await createConfiguredEvent(app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
  });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

const checkout = (token, orderId, body = {}) =>
  request(app).post(`/api/v1/orders/${orderId}/checkout`).set(bearer(token)).send(body);

const pay = (token, body, key = randomUUID()) =>
  request(app).post('/api/v1/payments').set(bearer(token)).set('Idempotency-Key', key).send(body);

async function createPromotion(overrides = {}) {
  const res = await request(app)
    .post('/api/v1/promotions')
    .set(bearer(admin.token))
    .send({
      code: `SALE${randomUUID().slice(0, 8)}`,
      name: 'Sale',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      ...overrides,
    })
    .expect(201);
  return res.body.data.promotion;
}

/** One buyer holding seat A01 (2.000.000đ) of a fresh event. */
async function heldOrder(body) {
  const world = await onSale();
  const [buyer] = await createCustomers(1);
  const { order } = (await book(app, buyer.token, world.schedule.id, body ?? { seatIds: [world.seat.A01] }).expect(201)).body.data;
  return { ...world, buyer, order };
}

const orderRow = async (id) => (await query(`SELECT * FROM orders WHERE id = $1`, [id])).rows[0];
const seatStatus = async (scheduleId, seatId) =>
  (await query(`SELECT status FROM schedule_seats WHERE schedule_id = $1 AND seat_id = $2`, [scheduleId, seatId])).rows[0].status;
const usedCount = async (promotionId) => (await query(`SELECT used_count FROM promotions WHERE id = $1`, [promotionId])).rows[0].used_count;
const gaCounters = async (ticketTypeId) =>
  (await query(`SELECT held_quantity, sold_quantity FROM ga_inventory WHERE ticket_type_id = $1`, [ticketTypeId])).rows[0];

// ---------------------------------------------------------------------------
// Checkout and promotions
// ---------------------------------------------------------------------------

describe('checkout (ORD-03)', () => {
  test('fixes the price and extends the hold once by the payment window', async () => {
    const { buyer, order, schedule, seat } = await heldOrder();
    const res = await checkout(buyer.token, order.id).expect(200);
    expect(res.body.data.order).toMatchObject({ status: 'PAYMENT_PENDING', totalAmount: 2_000_000, discountAmount: 0 });
    expect(res.body.data.order.checkedOutAt).toBeTruthy();
    expect(res.body.data.order.remainingSeconds).toBeGreaterThan(590);

    const { rows } = await query(
      `SELECT s.hold_expires_at = o.expires_at AS same_deadline FROM schedule_seats s JOIN orders o ON o.id = s.held_by_order_id
       WHERE s.schedule_id = $1 AND s.seat_id = $2`,
      [schedule.id, seat.A01],
    );
    expect(rows[0].same_deadline).toBe(true);

    expect((await checkout(buyer.token, order.id)).body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  test('promotions: percentage with a cap, fixed amount, and one use taken per checkout', async () => {
    const capped = await createPromotion({ discountValue: 20, maxDiscount: 300_000 });
    const first = await heldOrder();
    const res = await checkout(first.buyer.token, first.order.id, { promotionCode: capped.code.toLowerCase() }).expect(200);
    expect(res.body.data.order).toMatchObject({ subtotal: 2_000_000, discountAmount: 300_000, totalAmount: 1_700_000 });
    expect(await usedCount(capped.id)).toBe(1);

    const fixed = await createPromotion({ discountType: 'FIXED_AMOUNT', discountValue: 50_000 });
    const second = await heldOrder();
    const fixedRes = await checkout(second.buyer.token, second.order.id, { promotionCode: fixed.code }).expect(200);
    expect(fixedRes.body.data.order.totalAmount).toBe(1_950_000);
  });

  test('every refusal reason, and a refused checkout changes nothing', async () => {
    const now = Date.now();
    const cases = [
      ['NOT_FOUND', null],
      ['INACTIVE', { status: 'INACTIVE' }],
      ['NOT_STARTED', { startsAt: new Date(now + 3_600_000).toISOString(), expiresAt: new Date(now + 7_200_000).toISOString() }],
      ['EXPIRED', { startsAt: new Date(now - 7_200_000).toISOString(), expiresAt: new Date(now - 3_600_000).toISOString() }],
      ['MIN_ORDER_AMOUNT', { minOrderAmount: 5_000_000 }],
    ];
    const { buyer, order } = await heldOrder();
    for (const [reason, overrides] of cases) {
      const code = overrides ? (await createPromotion(overrides)).code : 'NO-SUCH-CODE';
      const res = await checkout(buyer.token, order.id, { promotionCode: code });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'PROMOTION_INVALID', details: { reason } });
    }
    expect((await orderRow(order.id)).status).toBe('HELD'); // every attempt was rolled back

    // One use per customer: the second order of the same customer is refused.
    const once = await createPromotion({ perUserLimit: 1 });
    await checkout(buyer.token, order.id, { promotionCode: once.code }).expect(200);
    const other = await onSale();
    const { order: second } = (await book(app, buyer.token, other.schedule.id, { seatIds: [other.seat.A01] }).expect(201)).body.data;
    expect((await checkout(buyer.token, second.id, { promotionCode: once.code })).body.error.details.reason).toBe('PER_USER_LIMIT');
  });

  test('PRO-03: two buyers race for the last use → exactly one gets it', async () => {
    const lastOne = await createPromotion({ usageLimit: 1 });
    const { schedule, seat } = await onSale();
    const [a, b] = await createCustomers(2);
    const orderA = (await book(app, a.token, schedule.id, { seatIds: [seat.A01] }).expect(201)).body.data.order;
    const orderB = (await book(app, b.token, schedule.id, { seatIds: [seat.A02] }).expect(201)).body.data.order;

    const results = await Promise.all([
      checkout(a.token, orderA.id, { promotionCode: lastOne.code }),
      checkout(b.token, orderB.id, { promotionCode: lastOne.code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(results.find((r) => r.status === 422).body.error.details.reason).toBe('USAGE_LIMIT');
    expect(await usedCount(lastOne.id)).toBe(1);
  });

  test('preview (PRO-01) uses nothing; an unpaid order that ends gives its use back', async () => {
    const promo = await createPromotion({ discountValue: 50 });
    const { buyer, order } = await heldOrder();
    const preview = await request(app)
      .post('/api/v1/promotions/validate')
      .set(bearer(buyer.token))
      .send({ code: promo.code, orderId: order.id })
      .expect(200);
    expect(preview.body.data.preview).toMatchObject({ discountAmount: 1_000_000, totalAmount: 1_000_000 });
    expect(await usedCount(promo.id)).toBe(0);

    await checkout(buyer.token, order.id, { promotionCode: promo.code }).expect(200);
    expect(await usedCount(promo.id)).toBe(1);
    await makeDue(order.id);
    await expireDueOrders({ userId: buyer.id }); // PAYMENT_PENDING orders expire too
    expect((await orderRow(order.id)).status).toBe('EXPIRED');
    expect(await usedCount(promo.id)).toBe(0);
  });

  test('a 100% code makes a 0đ order: PAID at checkout, no payment', async () => {
    const free = await createPromotion({ discountValue: 100 });
    const { buyer, order, schedule, seat } = await heldOrder();
    const res = await checkout(buyer.token, order.id, { promotionCode: free.code }).expect(200);
    expect(res.body.data.order).toMatchObject({ status: 'PAID', totalAmount: 0, payments: [] });
    expect(await seatStatus(schedule.id, seat.A01)).toBe('SOLD');
  });

  test('admin promotion management: duplicate code, discount locked once used', async () => {
    const promo = await createPromotion();
    const dup = await request(app)
      .post('/api/v1/promotions')
      .set(bearer(admin.token))
      .send({ code: promo.code, name: 'Dup', discountType: 'FIXED_AMOUNT', discountValue: 1, startsAt: promo.startsAt, expiresAt: promo.expiresAt });
    expect(dup.body.error.code).toBe('PROMOTION_CODE_TAKEN');

    const { buyer, order } = await heldOrder();
    await checkout(buyer.token, order.id, { promotionCode: promo.code }).expect(200);
    const change = await request(app).patch(`/api/v1/promotions/${promo.id}`).set(bearer(admin.token)).send({ discountValue: 90 });
    expect(change.body.error.code).toBe('INVALID_STATE_TRANSITION');
    await request(app).patch(`/api/v1/promotions/${promo.id}`).set(bearer(admin.token)).send({ status: 'INACTIVE' }).expect(200);
    await request(app).get('/api/v1/promotions').set(bearer(buyer.token)).expect(403);
  });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe('payments (PAY-01..04)', () => {
  test('pay a checked-out order: PAID, seats SOLD, GA sold; the payment is private', async () => {
    const world = await onSale();
    const [buyer, stranger] = await createCustomers(2);
    const { order } = (
      await book(app, buyer.token, world.schedule.id, { seatIds: [world.seat.A01], items: [{ ticketTypeId: world.standing.id, quantity: 2 }] }).expect(201)
    ).body.data;

    expect((await pay(buyer.token, { orderId: order.id })).body.error.code).toBe('ORDER_NOT_PAYABLE'); // checkout first
    await checkout(buyer.token, order.id).expect(200);
    const noKey = await request(app).post('/api/v1/payments').set(bearer(buyer.token)).send({ orderId: order.id });
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const { payment } = (await pay(buyer.token, { orderId: order.id }).expect(201)).body.data;
    expect(payment).toMatchObject({ status: 'SUCCESS', amount: 3_000_000, provider: 'SIMULATOR' });
    expect((await orderRow(order.id)).status).toBe('PAID');
    expect(await seatStatus(world.schedule.id, world.seat.A01)).toBe('SOLD');
    expect(await gaCounters(world.standing.id)).toEqual({ held_quantity: 0, sold_quantity: 2 });

    await request(app).get(`/api/v1/payments/${payment.id}`).set(bearer(buyer.token)).expect(200);
    await request(app).get(`/api/v1/payments/${payment.id}`).set(bearer(stranger.token)).expect(404);
    await request(app).get(`/api/v1/payments/${payment.id}`).set(bearer(admin.token)).expect(200);
  });

  test('PAY-02: the same Idempotency-Key 5 times at once → one payment, five identical answers', async () => {
    const { buyer, order } = await heldOrder();
    await checkout(buyer.token, order.id).expect(200);
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 5 }, () => pay(buyer.token, { orderId: order.id }, key)));
    expect(results.map((r) => r.status)).toEqual(Array(5).fill(201));
    expect(new Set(results.map((r) => r.body.data.payment.id)).size).toBe(1);
    expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(4);
    const { rows } = await query(`SELECT count(*)::int AS n FROM payments WHERE order_id = $1`, [order.id]);
    expect(rows[0].n).toBe(1);

    // Same key, different request → refused instead of silently returning the old answer.
    const reused = await pay(buyer.token, { orderId: order.id, simulate: 'FAILED' }, key);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  test('two different keys for one order at once → one success, one ORDER_ALREADY_PAID', async () => {
    const { buyer, order } = await heldOrder();
    await checkout(buyer.token, order.id).expect(200);
    const results = await Promise.all([pay(buyer.token, { orderId: order.id }), pay(buyer.token, { orderId: order.id })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('ORDER_ALREADY_PAID');
    const { rows } = await query(`SELECT count(*)::int AS n FROM payments WHERE order_id = $1 AND status = 'SUCCESS'`, [order.id]);
    expect(rows[0].n).toBe(1);
  });

  test('PAY-04: a declined payment keeps the seats; a retry with a new key succeeds', async () => {
    const { buyer, order, schedule, seat } = await heldOrder();
    await checkout(buyer.token, order.id).expect(200);

    const failed = (await pay(buyer.token, { orderId: order.id, simulate: 'FAILED' }).expect(201)).body.data.payment;
    expect(failed).toMatchObject({ status: 'FAILED', failureCode: 'CARD_DECLINED' });
    expect((await orderRow(order.id)).status).toBe('PAYMENT_FAILED');
    expect(await seatStatus(schedule.id, seat.A01)).toBe('HELD');

    await pay(buyer.token, { orderId: order.id }).expect(201);
    const detail = await request(app).get(`/api/v1/orders/${order.id}`).set(bearer(buyer.token)).expect(200);
    expect(detail.body.data.order.status).toBe('PAID');
    expect(detail.body.data.order.payments.map((p) => p.status)).toEqual(['SUCCESS', 'FAILED']);
  });

  test('paying an order whose time is up: ORDER_EXPIRED, nothing charged, seats back on sale', async () => {
    const { buyer, order, schedule, seat } = await heldOrder();
    await checkout(buyer.token, order.id).expect(200);
    await makeDue(order.id);

    expect((await pay(buyer.token, { orderId: order.id })).body.error.code).toBe('ORDER_EXPIRED');
    expect((await orderRow(order.id)).status).toBe('EXPIRED');
    expect(await seatStatus(schedule.id, seat.A01)).toBe('AVAILABLE');
    const { rows } = await query(`SELECT count(*)::int AS n FROM payments WHERE order_id = $1`, [order.id]);
    expect(rows[0].n).toBe(0);
  });

  test('cancelling a checked-out or failed order is allowed and releases everything', async () => {
    const { buyer, order, schedule, seat } = await heldOrder();
    await checkout(buyer.token, order.id).expect(200);
    await pay(buyer.token, { orderId: order.id, simulate: 'FAILED' }).expect(201);
    await cancelOrder(app, buyer.token, order.id).expect(200);
    expect(await seatStatus(schedule.id, seat.A01)).toBe('AVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

describe('refunds (PAY-05, EVT-08)', () => {
  async function paidOrder() {
    const world = await onSale();
    const [buyer] = await createCustomers(1);
    const { order } = (
      await book(app, buyer.token, world.schedule.id, { seatIds: [world.seat.A01], items: [{ ticketTypeId: world.standing.id, quantity: 3 }] }).expect(201)
    ).body.data;
    await checkout(buyer.token, order.id).expect(200);
    const { payment } = (await pay(buyer.token, { orderId: order.id }).expect(201)).body.data;
    return { ...world, buyer, order, payment };
  }

  test('a refund puts seats and GA tickets back on sale, once, audited', async () => {
    const { buyer, order, payment, schedule, seat, standing } = await paidOrder();
    await request(app).post(`/api/v1/payments/${payment.id}/refund`).set(bearer(buyer.token)).send({ reason: 'I want it' }).expect(403);

    const res = await request(app)
      .post(`/api/v1/payments/${payment.id}/refund`)
      .set(bearer(admin.token))
      .send({ reason: 'Customer is ill' })
      .expect(200);
    expect(res.body.data.payment.status).toBe('REFUNDED');
    expect((await orderRow(order.id)).status).toBe('REFUNDED');
    expect(await seatStatus(schedule.id, seat.A01)).toBe('AVAILABLE');
    expect(await gaCounters(standing.id)).toEqual({ held_quantity: 0, sold_quantity: 0 });

    const again = await request(app).post(`/api/v1/payments/${payment.id}/refund`).set(bearer(admin.token)).send({ reason: 'Twice' });
    expect(again.body.error.code).toBe('PAYMENT_NOT_REFUNDABLE');
    const { rows } = await query(`SELECT action, new_value FROM audit_logs WHERE entity_id = $1`, [order.id]);
    expect(rows).toEqual([expect.objectContaining({ action: 'PAYMENT_REFUNDED', new_value: expect.objectContaining({ amount: 3_500_000 }) })]);
  });

  test('cancelling the event refunds paid orders and cancels open ones, in one transaction', async () => {
    const { event, schedule, order: paid, seat } = await paidOrder();
    const [other] = await createCustomers(1);
    const open = (await book(app, other.token, schedule.id, { seatIds: [seat.A02] }).expect(201)).body.data.order;

    await changeStatus(app, organizer.token, event.id, 'CANCELLED', 'Storm warning').expect(200);
    expect((await orderRow(paid.id)).status).toBe('REFUNDED');
    expect((await orderRow(open.id)).status).toBe('CANCELLED');
    const { rows } = await query(`SELECT new_value FROM audit_logs WHERE entity_id = $1 AND action = 'EVENT_CANCELLED'`, [event.id]);
    expect(rows[0].new_value).toMatchObject({ heldOrdersCancelled: 1, paidOrdersRefunded: 1 });
  });
});

// ---------------------------------------------------------------------------
// Real-time
// ---------------------------------------------------------------------------

describe('real-time messages', () => {
  test('viewers see SEAT_SOLD; the buyer hears PAYMENT_SUCCEEDED and ORDER_PAID', async () => {
    const server = await startServer();
    try {
      const { buyer, order, schedule, seat } = await heldOrder();
      const viewer = await connect(server.url);
      viewer.send({ type: 'SUBSCRIBE', scheduleId: schedule.id });
      await viewer.waitFor('SUBSCRIBED');
      const owner = await connect(server.url);
      owner.send({ type: 'AUTH', token: buyer.token });
      await owner.waitFor('AUTH_OK');

      await checkout(buyer.token, order.id).expect(200);
      await pay(buyer.token, { orderId: order.id }).expect(201);
      expect((await viewer.waitFor('SEAT_SOLD')).seats).toEqual([{ seatId: seat.A01, status: 'SOLD', version: expect.any(Number) }]);
      expect(await owner.waitFor('PAYMENT_SUCCEEDED')).toMatchObject({ orderId: order.id });
      expect(await owner.waitFor('ORDER_PAID')).toEqual({ type: 'ORDER_PAID', orderId: order.id });
      viewer.close();
      owner.close();
    } finally {
      await server.stop();
    }
  });
});

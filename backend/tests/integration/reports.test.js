const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, refundOrder } = require('../helpers/orders');
const { findInventoryMismatches } = require('../../src/modules/orders');
const { fillRate } = require('../../src/modules/reports/reports.service');
const { vnToday, addDays } = require('../../src/modules/reports/vn-date');
const { TERMS_VERSION } = require('../../src/config/constants');

const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizer;
let otherOrganizer;
let category;

beforeAll(async () => {
  admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  otherOrganizer = await createOrganizer(app, mailbox, admin.token);
  category = await createCategory(app, admin.token);
});
afterAll(() => closePool());
afterEach(async () => {
  expect(await findInventoryMismatches(pool)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** PUBLISHED event: CAT1 = A01..A10 (2.000.000đ), CAT2 = B01..B10 (1.000.000đ), STAND = 100 GA (500.000đ). */
async function onSale() {
  const world = await createConfiguredEvent(app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
  });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

async function createPromotion() {
  const res = await request(app)
    .post('/api/v1/promotions')
    .set(bearer(admin.token))
    .send({
      code: `REP${randomUUID().slice(0, 8)}`,
      name: 'Report sale',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .expect(201);
  return res.body.data.promotion;
}

/** A new buyer books `body`, checks out (with an optional code) and pays. */
async function buy(scheduleId, body, promotionCode) {
  const [buyer] = await createCustomers(1);
  const { order } = (await book(app, buyer.token, scheduleId, body).expect(201)).body.data;
  await request(app)
    .post(`/api/v1/orders/${order.id}/checkout`)
    .set(bearer(buyer.token))
    .send({ termsVersion: TERMS_VERSION, ...(promotionCode ? { promotionCode } : {}) })
    .expect(200);
  const { payment } = (
    await request(app).post('/api/v1/payments').set(bearer(buyer.token)).set('Idempotency-Key', randomUUID()).send({ orderId: order.id }).expect(201)
  ).body.data;
  return { buyer, order, payment };
}

const refund = (paymentId) => refundOrder(paymentId, 'Report test');

const eventSales = (token, eventId) => request(app).get(`/api/v1/reports/events/${eventId}/sales`).set(bearer(token));
const platformSales = (token, qs) => request(app).get(`/api/v1/reports/sales?${qs}`).set(bearer(token));

/** A gate scan, written straight to the table (the scanning rules are tested in checkins.test.js). */
async function checkInOne(orderId) {
  await query(
    `WITH t AS (UPDATE tickets SET status = 'USED', used_at = now()
                WHERE id = (SELECT id FROM tickets WHERE order_id = $1 ORDER BY ticket_code LIMIT 1)
                RETURNING id, event_id, schedule_id, user_id)
     INSERT INTO check_ins (ticket_id, event_id, schedule_id, staff_user_id) SELECT id, event_id, schedule_id, user_id FROM t`,
    [orderId],
  );
}

// ---------------------------------------------------------------------------

describe('fill rate', () => {
  test('sold ÷ places that can be sold, rounded to 0.1 %; null when nothing can be sold', () => {
    expect(fillRate(2, 10, 1)).toBe(0.222);
    expect(fillRate(0, 0, 0)).toBeNull();
    expect(fillRate(0, 5, 5)).toBeNull();
  });
});

describe('event report (REP-01)', () => {
  test('counts sold orders only, with discounts, refunds, blocked places, check-ins and codes', async () => {
    const world = await onSale();
    const { schedule, seat, cat1, cat2, standing } = world;
    const promotion = await createPromotion();

    // Sold with 10 % off: A01 + A02 (2 × 2.000.000) + 3 standing (3 × 500.000) = 5.500.000 − 550.000.
    const sold = await buy(schedule.id, { seatIds: [seat.A01, seat.A02], items: [{ ticketTypeId: standing.id, quantity: 3 }] }, promotion.code);
    // Paid, then refunded: B01 (1.000.000).
    const refunded = await buy(schedule.id, { seatIds: [seat.B01] });
    await refund(refunded.payment.id);
    // Only held: not counted.
    const [holder] = await createCustomers(1);
    await book(app, holder.token, schedule.id, { seatIds: [seat.A03] }).expect(201);
    // A10 blocked by the organizer: not for sale.
    await request(app)
      .post(`/api/v1/schedules/${schedule.id}/inventory/block`)
      .set(bearer(organizer.token))
      .send({ action: 'BLOCK', reason: 'Camera', seatIds: [seat.A10] })
      .expect(200);
    await checkInOne(sold.order.id);

    const report = (await eventSales(organizer.token, world.event.id).expect(200)).body.data;

    expect(report.totals).toEqual({
      orders: 1,
      gross: 5_500_000,
      discount: 550_000,
      revenue: 4_950_000,
      cancellationFees: 0, // a refund gives everything back
      refunds: { orders: 1, amount: 1_000_000 },
      capacity: 120,
      blocked: 1,
      tickets: 5,
      checkedIn: 1,
      fillRate: Math.round((5 / 119) * 1000) / 1000,
    });
    const [only] = report.schedules;
    const byId = Object.fromEntries(only.ticketTypes.map((tt) => [tt.id, tt]));
    expect(byId[cat1.id]).toMatchObject({ capacity: 10, blocked: 1, sold: 2, fillRate: 0.222, revenue: 4_000_000, mode: 'RESERVED' });
    expect(byId[cat2.id]).toMatchObject({ capacity: 10, blocked: 0, sold: 0, revenue: 0 });
    expect(byId[standing.id]).toMatchObject({ capacity: 100, sold: 3, fillRate: 0.03, revenue: 1_500_000, mode: 'GENERAL_ADMISSION' });
    expect(only.ticketTypes.reduce((n, tt) => n + tt.checkedIn, 0)).toBe(1);
    expect(only.totals.revenue).toBe(report.totals.revenue);

    expect(report.promotions).toEqual([{ code: promotion.code, name: 'Report sale', orders: 1, discount: 550_000 }]);

    // Today in Vietnam: the sale and the refund; the days add up to the totals.
    const today = report.daily.at(-1);
    expect(today).toEqual({ date: vnToday(), orders: 1, tickets: 5, revenue: 4_950_000, cancellationFees: 0, refunds: { orders: 1, amount: 1_000_000 } });
    expect(report.daily.reduce((n, d) => n + d.revenue, 0)).toBe(report.totals.revenue);
    expect(report.daily).toHaveLength(14); // sold today only: the chart still shows two weeks
  });

  test('only the event organizer (or an admin) may read it: others get 404, customers 403', async () => {
    const { event } = await onSale();
    await eventSales(admin.token, event.id).expect(200);
    expect((await eventSales(otherOrganizer.token, event.id).expect(404)).body.error.code).toBe('NOT_FOUND');
    await eventSales(organizer.token, randomUUID()).expect(404);
    const [customer] = await createCustomers(1);
    await eventSales(customer.token, event.id).expect(403);
  });

  test('my events: one line per event of my organizer, with totals', async () => {
    const world = await onSale();
    await buy(world.schedule.id, { seatIds: [world.seat.A05] });

    const mine = (await request(app).get('/api/v1/reports/my-events').set(bearer(organizer.token)).expect(200)).body.data;
    const line = mine.events.find((e) => e.id === world.event.id);
    expect(line).toMatchObject({ status: 'PUBLISHED', capacity: 120, blocked: 0, orders: 1, tickets: 1, revenue: 2_000_000 });
    expect(line.nextStartAt).toBeTruthy();
    expect(mine.totals.revenue).toBe(mine.events.reduce((n, e) => n + e.revenue, 0));

    const theirs = (await request(app).get('/api/v1/reports/my-events').set(bearer(otherOrganizer.token)).expect(200)).body.data;
    expect(theirs.events.find((e) => e.id === world.event.id)).toBeUndefined();
  });
});

describe('platform report (REP-02)', () => {
  test('days are Vietnamese days; a refund leaves the day it was paid and shows on the refund day', async () => {
    const world = await onSale();
    const late = await buy(world.schedule.id, { seatIds: [world.seat.A06] });
    const early = await buy(world.schedule.id, { seatIds: [world.seat.A07] });
    // 16:59 UTC = 23:59 in Vietnam on 1 March; 17:00 UTC = 00:00 on 2 March. Long ago, so no other test sells on these days.
    await query(`UPDATE orders SET paid_at = '2020-03-01T16:59:00Z' WHERE id = $1`, [late.order.id]);
    await query(`UPDATE orders SET paid_at = '2020-03-01T17:00:00Z' WHERE id = $1`, [early.order.id]);

    let report = (await platformSales(admin.token, 'from=2020-03-01&to=2020-03-03').expect(200)).body.data;
    expect(report.daily.map((d) => [d.date, d.revenue])).toEqual([
      ['2020-03-01', 2_000_000],
      ['2020-03-02', 2_000_000],
      ['2020-03-03', 0],
    ]);
    expect(report.totals).toMatchObject({ orders: 2, tickets: 2, gross: 4_000_000, discount: 0, revenue: 4_000_000, buyers: 2 });
    expect(report.topEvents[0]).toMatchObject({ id: world.event.id, orders: 2, revenue: 4_000_000 });
    expect(report.byOrganizer[0]).toMatchObject({ id: organizer.organizerId, revenue: 4_000_000 });

    await refund(early.payment.id);
    // Phase 17: a refund counts on the day it was made (a VNPay refund may complete later, or fail and be sent again).
    await query(`UPDATE refunds SET created_at = '2020-03-03T01:00:00Z', completed_at = '2020-03-03T01:00:00Z' WHERE order_id = $1`, [
      early.order.id,
    ]);
    report = (await platformSales(admin.token, 'from=2020-03-01&to=2020-03-03').expect(200)).body.data;
    expect(report.daily.map((d) => [d.date, d.revenue, d.refunds.amount])).toEqual([
      ['2020-03-01', 2_000_000, 0],
      ['2020-03-02', 0, 0],
      ['2020-03-03', 0, 2_000_000],
    ]);
    expect(report.totals).toMatchObject({ orders: 1, revenue: 2_000_000, refunds: { orders: 1, amount: 2_000_000 } });
  });

  test('the range is checked: order, length (366 days), not in the future, format', async () => {
    const today = vnToday();
    await platformSales(admin.token, `from=${addDays(today, -365)}&to=${today}`).expect(200);
    for (const qs of [
      `from=${addDays(today, -366)}&to=${today}`,
      `from=${today}&to=${addDays(today, -1)}`,
      `from=${today}&to=${addDays(today, 1)}`,
      'from=2026-13-01&to=2026-12-31',
      'from=2026-01-01',
    ]) {
      expect((await platformSales(admin.token, qs).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('admins only', async () => {
    await platformSales(organizer.token, 'from=2020-03-01&to=2020-03-03').expect(403);
    await request(app).get('/api/v1/reports/overview').set(bearer(organizer.token)).expect(403);
  });

  test('dashboard: today, 7 and 30 days add up from the 30 daily rows', async () => {
    const world = await onSale();
    await buy(world.schedule.id, { seatIds: [world.seat.A08] });

    const data = (await request(app).get('/api/v1/reports/overview').set(bearer(admin.token)).expect(200)).body.data;
    expect(data.daily).toHaveLength(30);
    expect(data.daily.at(-1).date).toBe(vnToday());
    expect(data.today.revenue).toBe(data.daily.at(-1).revenue);
    expect(data.today.revenue).toBeGreaterThanOrEqual(2_000_000);
    expect(data.last7Days.revenue).toBe(data.daily.slice(-7).reduce((n, d) => n + d.revenue, 0));
    expect(data.last30Days.orders).toBe(data.daily.reduce((n, d) => n + d.orders, 0));
    expect(data.topEvents.length).toBeGreaterThan(0);
    expect(data.publishedEvents).toBeGreaterThan(0);
  });
});

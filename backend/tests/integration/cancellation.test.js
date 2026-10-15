const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book } = require('../helpers/orders');
const { startFakeVnpay, signedCallback, nextTransactionNo } = require('../helpers/fake-vnpay');
const { findInventoryMismatches } = require('../../src/modules/orders');
const vnpay = require('../../src/modules/payments/vnpay');

/** Phase 18.3: a buyer cancels a paid order under the event's refund policy. */
const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizer;
let category;
let fake;

beforeAll(async () => {
  fake = await startFakeVnpay();
  admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  category = await createCategory(app, admin.token);
});
afterAll(async () => {
  await fake.close();
  await closePool();
});
beforeEach(() => fake.reset());
afterEach(async () => {
  expect(await findInventoryMismatches(pool)).toEqual([]);
});

/** A published event (show in 30 days) with this policy; seat A01 = 2.000.000đ. */
async function onSale(policy = 'STANDARD') {
  const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  const res = await request(app).patch(`/api/v1/events/${world.event.id}`).set(bearer(organizer.token)).send({ refundPolicy: policy }).expect(200);
  expect(res.body.data.event.refundPolicy).toBe(policy);
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

async function holdAndCheckout(world, buyer, seatCode = 'A01', body = {}) {
  const { order } = (await book(app, buyer.token, world.schedule.id, { seatIds: [world.seat[seatCode]] }).expect(201)).body.data;
  await request(app).post(`/api/v1/orders/${order.id}/checkout`).set(bearer(buyer.token)).send(body).expect(200);
  return order;
}

/** Paid with the simulator. */
async function paidOrder(policy) {
  const world = await onSale(policy);
  const [buyer] = await createCustomers(1);
  const order = await holdAndCheckout(world, buyer);
  await request(app).post('/api/v1/payments').set(bearer(buyer.token)).set('Idempotency-Key', randomUUID()).send({ orderId: order.id }).expect(201);
  return { ...world, buyer, order };
}

const preview = (token, orderId) => request(app).get(`/api/v1/orders/${orderId}/cancellation`).set(bearer(token));
const cancel = (token, orderId, refundAmount) =>
  request(app).post(`/api/v1/orders/${orderId}/cancellation`).set(bearer(token)).send({ refundAmount });
const moveShow = (scheduleId, startsIn) =>
  query(
    `UPDATE event_schedules SET start_at = now() + $2::interval, end_at = now() + $2::interval + interval '2 hours',
            sales_end_at = now() + $2::interval - interval '1 hour', sales_start_at = least(sales_start_at, now() - interval '1 day')
     WHERE id = $1`,
    [scheduleId, startsIn],
  );
const orderStatus = async (id) => (await query(`SELECT status FROM orders WHERE id = $1`, [id])).rows[0].status;
const refundsOf = async (orderId) => (await query(`SELECT amount, status FROM refunds WHERE order_id = $1`, [orderId])).rows;
const emailOf = async (userId) => (await query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0].email;

describe('cancelling a paid order (simulator)', () => {
  test('Tiêu chuẩn, 30 days before: 80% back, the seat on sale again, audited, emailed with the fee', async () => {
    const { buyer, order, schedule, seat } = await paidOrder('STANDARD');
    const terms = (await preview(buyer.token, order.id).expect(200)).body.data.cancellation;
    expect(terms).toMatchObject({ allowed: true, policy: 'STANDARD', percent: 80, refundAmount: 1_600_000, fee: 400_000 });
    const { start_at: startAt } = (await query(`SELECT start_at FROM event_schedules WHERE id = $1`, [schedule.id])).rows[0];
    expect(new Date(terms.tierEndsAt).getTime()).toBe(startAt.getTime() - 7 * 24 * 3600_000);

    const res = await cancel(buyer.token, order.id, 1_600_000).expect(200);
    expect(res.body.data.cancellation).toMatchObject({ status: 'REFUNDED', refundAmount: 1_600_000, fee: 400_000 });
    expect(await orderStatus(order.id)).toBe('REFUNDED');
    expect(await refundsOf(order.id)).toEqual([{ amount: 1_600_000, status: 'SUCCESS' }]);
    const seatRow = (await query(`SELECT status FROM schedule_seats WHERE schedule_id = $1 AND seat_id = $2`, [schedule.id, seat.A01])).rows[0];
    expect(seatRow.status).toBe('AVAILABLE');
    const { rows } = await query(`SELECT action, new_value FROM audit_logs WHERE entity_id = $1`, [order.id]);
    expect(rows).toEqual([
      expect.objectContaining({ action: 'ORDER_CANCELLED_BY_CUSTOMER', new_value: expect.objectContaining({ amount: 1_600_000, fee: 400_000 }) }),
    ]);
    const email = await emailOf(buyer.id);
    expect(mailbox.latestText(email)).toContain('đã được hoàn 1.600.000đ. Phí hủy theo chính sách của sự kiện: 400.000đ.');

    // Once only.
    const again = await cancel(buyer.token, order.id, 1_600_000).expect(409);
    expect(again.body.error).toMatchObject({ code: 'ORDER_NOT_CANCELLABLE', details: { reason: 'NOT_PAID' } });
  });

  test('the amount the customer saw must still be right; tiers move with time; too late → refused', async () => {
    const { buyer, order, schedule } = await paidOrder('STANDARD');
    await moveShow(schedule.id, '5 days');
    const changed = await cancel(buyer.token, order.id, 1_600_000).expect(409);
    expect(changed.body.error).toMatchObject({ code: 'REFUND_TERMS_CHANGED', details: { refundAmount: 1_000_000, percent: 50 } });
    expect(await orderStatus(order.id)).toBe('PAID'); // nothing happened

    await moveShow(schedule.id, '2 days');
    expect((await preview(buyer.token, order.id).expect(200)).body.data.cancellation).toMatchObject({ allowed: false, reason: 'TOO_LATE' });
    expect((await cancel(buyer.token, order.id, 0).expect(409)).body.error.details.reason).toBe('TOO_LATE');
  });

  test('refused: policy "Không hoàn", a ticket already used at the gate, someone else’s order', async () => {
    const none = await paidOrder('NONE');
    expect((await preview(none.buyer.token, none.order.id).expect(200)).body.data.cancellation).toMatchObject({
      allowed: false,
      reason: 'NO_REFUND_POLICY',
    });

    const used = await paidOrder('FLEXIBLE');
    await query(`UPDATE tickets SET status = 'USED', used_at = now() WHERE order_id = $1`, [used.order.id]);
    expect((await cancel(used.buyer.token, used.order.id, 2_000_000).expect(409)).body.error.details.reason).toBe('CHECKED_IN');
    await query(`UPDATE tickets SET status = 'VALID', used_at = NULL WHERE order_id = $1`, [used.order.id]);

    const [stranger] = await createCustomers(1);
    await preview(stranger.token, used.order.id).expect(404);
    await cancel(stranger.token, used.order.id, 2_000_000).expect(404);
  });

  test('two cancels at the same time: one refund', async () => {
    const { buyer, order } = await paidOrder('FLEXIBLE');
    const results = await Promise.all([cancel(buyer.token, order.id, 2_000_000), cancel(buyer.token, order.id, 2_000_000)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await refundsOf(order.id)).toEqual([{ amount: 2_000_000, status: 'SUCCESS' }]);
  });

  test('a 0đ order (100% code): cancelled, nothing to refund', async () => {
    const world = await onSale('FLEXIBLE');
    const code = `FREE${randomUUID().slice(0, 8)}`;
    await request(app)
      .post('/api/v1/promotions')
      .set(bearer(admin.token))
      .send({
        code,
        name: 'Free',
        discountType: 'PERCENTAGE',
        discountValue: 100,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);
    const [buyer] = await createCustomers(1);
    const order = await holdAndCheckout(world, buyer, 'A02', { promotionCode: code });
    expect(await orderStatus(order.id)).toBe('PAID');
    await cancel(buyer.token, order.id, 0).expect(200);
    expect(await orderStatus(order.id)).toBe('REFUNDED');
    expect(await refundsOf(order.id)).toEqual([]);
  });

  test('the event report counts the fee as revenue', async () => {
    const { buyer, order, event } = await paidOrder('STANDARD');
    await cancel(buyer.token, order.id, 1_600_000).expect(200);
    const report = (await request(app).get(`/api/v1/reports/events/${event.id}/sales`).set(bearer(organizer.token)).expect(200)).body.data;
    expect(report.totals).toMatchObject({ orders: 0, revenue: 400_000, cancellationFees: 400_000, refunds: { orders: 1, amount: 1_600_000 } });
    expect(report.daily.at(-1)).toMatchObject({ revenue: 400_000, cancellationFees: 400_000 });
  });
});

describe('cancelling a VNPay order', () => {
  test('part of the payment goes back through VNPay (transaction type 03)', async () => {
    const world = await onSale('STANDARD');
    const [buyer] = await createCustomers(1);
    const order = await holdAndCheckout(world, buyer);
    const { paymentId } = (await request(app).post('/api/v1/payments/vnpay').set(bearer(buyer.token)).send({ orderId: order.id }).expect(201)).body.data;
    const ref = paymentId.replace(/-/g, '');
    const transactionNo = nextTransactionNo();
    const ipn = signedCallback({
      vnp_Amount: '200000000',
      vnp_BankCode: 'NCB',
      vnp_PayDate: vnpay.vnTime(),
      vnp_ResponseCode: '00',
      vnp_TmnCode: 'TESTTMN1',
      vnp_TransactionNo: transactionNo,
      vnp_TransactionStatus: '00',
      vnp_TxnRef: ref,
    });
    expect((await request(app).get('/api/v1/payments/vnpay/ipn').query(ipn).expect(200)).body.RspCode).toBe('00');

    await cancel(buyer.token, order.id, 1_600_000).expect(200);
    expect(fake.refundsSent()).toEqual([
      expect.objectContaining({ vnp_TxnRef: ref, vnp_Amount: '160000000', vnp_TransactionType: '03', vnp_TransactionNo: transactionNo }),
    ]);
    expect(await refundsOf(order.id)).toEqual([{ amount: 1_600_000, status: 'SUCCESS' }]);
  });
});

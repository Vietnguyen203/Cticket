const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory, changeStatus } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, cancelOrder, makeDue } = require('../helpers/orders');
const { startFakeVnpay, signedCallback, nextTransactionNo } = require('../helpers/fake-vnpay');
const { expireDueOrders } = require('../../src/modules/orders/order-release');
const { findInventoryMismatches } = require('../../src/modules/orders');
const vnpay = require('../../src/modules/payments/vnpay');
const payments = require('../../src/modules/payments');

/**
 * Phase 17: payments through VNPay, against a fake VNPay API
 * (tests/helpers/fake-vnpay.js). See docs/phase-17-vnpay-design.md.
 */
const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizer;
let category;
let fake;

const userIdOf = async (email) => (await query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id;

beforeAll(async () => {
  fake = await startFakeVnpay();
  admin = await createAdmin(app);
  admin.id = await userIdOf(admin.email);
  organizer = await createOrganizer(app, mailbox, admin.token);
  organizer.id = await userIdOf(organizer.email);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A buyer with seat A01 (2.000.000đ) of a fresh event, checked out (PAYMENT_PENDING). */
async function checkedOutOrder() {
  const world = await createConfiguredEvent(app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
  });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  const seat = Object.fromEntries(world.seats.map((s) => [s.code, s.id]));
  const [buyer] = await createCustomers(1);
  const { order } = (await book(app, buyer.token, world.schedule.id, { seatIds: [seat.A01] }).expect(201)).body.data;
  await request(app).post(`/api/v1/orders/${order.id}/checkout`).set(bearer(buyer.token)).send({}).expect(200);
  return { ...world, seat, buyer, order };
}

const startVnpay = (token, orderId) => request(app).post('/api/v1/payments/vnpay').set(bearer(token)).send({ orderId });

/** A started attempt: its id, VNPay reference (vnp_TxnRef) and amount. */
async function startAttempt(token, orderId) {
  const { paymentId, paymentUrl } = (await startVnpay(token, orderId).expect(201)).body.data;
  return { id: paymentId, ref: paymentId.replace(/-/g, ''), amount: 2_000_000, url: new URL(paymentUrl) };
}

/** The parameters VNPay sends to the IPN and the Return URL, signed. */
function callback(attempt, { code = '00', amount = attempt.amount, tmnCode = 'TESTTMN1', transactionNo } = {}) {
  const paid = code === '00';
  return signedCallback({
    vnp_Amount: String(amount * 100),
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: paid ? `VNP${transactionNo}` : '',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: 'Thanh toan don ETP',
    vnp_PayDate: vnpay.vnTime(),
    vnp_ResponseCode: code,
    vnp_TmnCode: tmnCode,
    vnp_TransactionNo: paid ? (transactionNo ?? nextTransactionNo()) : '0',
    vnp_TransactionStatus: paid ? '00' : '02',
    vnp_TxnRef: attempt.ref,
  });
}

const ipn = (params) => request(app).get('/api/v1/payments/vnpay/ipn').query(params).expect(200);
const vnpayReturn = (token, params) => request(app).get('/api/v1/payments/vnpay/return').set(bearer(token)).query(params);
const adminRefund = (paymentId) =>
  request(app).post(`/api/v1/payments/${paymentId}/refund`).set(bearer(admin.token)).send({ reason: 'Customer is ill' });

const orderStatus = async (id) => (await query(`SELECT status FROM orders WHERE id = $1`, [id])).rows[0].status;
const paymentRow = async (id) => (await query(`SELECT * FROM payments WHERE id = $1`, [id])).rows[0];
const refundsOf = async (paymentId) =>
  (await query(`SELECT * FROM refunds WHERE payment_id = $1 ORDER BY created_at`, [paymentId])).rows;
const ticketCount = async (orderId) =>
  (await query(`SELECT count(*)::int AS n FROM tickets WHERE order_id = $1`, [orderId])).rows[0].n;
const seatStatus = async (scheduleId, seatId) =>
  (await query(`SELECT status FROM schedule_seats WHERE schedule_id = $1 AND seat_id = $2`, [scheduleId, seatId])).rows[0].status;
const emailOf = async (userId) => (await query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0].email;
const auditActions = async (entityId) =>
  (await query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`, [entityId])).rows.map((r) => r.action);

/** A VNPay order paid through the IPN. */
async function paidByVnpay() {
  const world = await checkedOutOrder();
  const attempt = await startAttempt(world.buyer.token, world.order.id);
  const transactionNo = nextTransactionNo();
  expect((await ipn(callback(attempt, { transactionNo }))).body.RspCode).toBe('00');
  return { ...world, attempt, transactionNo };
}

// ---------------------------------------------------------------------------
// Starting a payment
// ---------------------------------------------------------------------------

describe('starting a VNPay payment', () => {
  test('the methods the order page may offer', async () => {
    const res = await request(app).get('/api/v1/payments/methods').expect(200);
    expect(res.body.data.methods).toEqual(['VNPAY', 'SIMULATOR']);
  });

  test('the URL: signed, amount × 100, our reference, VNPay stops 2 minutes before the order expires', async () => {
    const { buyer, order } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    const params = Object.fromEntries(attempt.url.searchParams);
    expect(vnpay.verifyCallback(params).valid).toBe(true);
    expect(params).toMatchObject({
      vnp_Command: 'pay',
      vnp_TmnCode: 'TESTTMN1',
      vnp_Amount: '200000000',
      vnp_TxnRef: attempt.ref,
      vnp_IpAddr: '127.0.0.1',
    });
    const { expires_at: expiresAt } = (await query(`SELECT expires_at FROM orders WHERE id = $1`, [order.id])).rows[0];
    expect(params.vnp_ExpireDate).toBe(vnpay.vnTime(new Date(expiresAt.getTime() - 120_000)));

    const row = await paymentRow(attempt.id);
    expect(row).toMatchObject({ status: 'PENDING', provider: 'VNPAY', amount: 2_000_000, provider_ref: attempt.ref });
    expect(row.provider_create_date).toBe(params.vnp_CreateDate);
    expect(await orderStatus(order.id)).toBe('PAYMENT_PENDING');
  });

  test('refused: another customer’s order, an order not checked out, less than 3 minutes left', async () => {
    const { buyer, order, schedule, seat } = await checkedOutOrder();
    const [stranger] = await createCustomers(1);
    expect((await startVnpay(stranger.token, order.id)).body.error.code).toBe('NOT_FOUND');

    const held = (await book(app, stranger.token, schedule.id, { seatIds: [seat.A02] }).expect(201)).body.data.order;
    expect((await startVnpay(stranger.token, held.id)).body.error.code).toBe('ORDER_NOT_PAYABLE');

    await query(`UPDATE orders SET expires_at = now() + interval '170 seconds' WHERE id = $1`, [order.id]);
    await query(`UPDATE schedule_seats SET hold_expires_at = now() + interval '170 seconds' WHERE held_by_order_id = $1`, [order.id]);
    const late = await startVnpay(buyer.token, order.id).expect(409);
    expect(late.body.error.code).toBe('ORDER_NOT_PAYABLE');
    expect((await query(`SELECT count(*)::int AS n FROM payments WHERE order_id = $1`, [order.id])).rows[0].n).toBe(0);
    await cancelOrder(app, stranger.token, held.id).expect(200);
  });
});

// ---------------------------------------------------------------------------
// IPN (VNPay's server calls ours)
// ---------------------------------------------------------------------------

describe('IPN', () => {
  test('paid → order PAID and tickets issued (00); the same IPN again → 02', async () => {
    const { buyer, order, attempt, transactionNo } = await paidByVnpay();
    expect(await orderStatus(order.id)).toBe('PAID');
    expect(await ticketCount(order.id)).toBe(1);
    expect(await paymentRow(attempt.id)).toMatchObject({
      status: 'SUCCESS',
      provider_transaction_id: transactionNo,
      provider_response_code: '00',
    });
    expect(mailbox.subjects(await emailOf(buyer.id))).toEqual([expect.stringContaining('Xác nhận đơn')]);

    expect((await ipn(callback(attempt, { transactionNo }))).body).toEqual({ RspCode: '02', Message: 'Order already confirmed' });
    expect(await ticketCount(order.id)).toBe(1);

    // The order shows how it was paid.
    const res = await request(app).get(`/api/v1/orders/${order.id}`).set(bearer(buyer.token)).expect(200);
    expect(res.body.data.order.payments).toEqual([
      expect.objectContaining({ provider: 'VNPAY', status: 'SUCCESS', providerTransactionId: transactionNo, bankCode: 'NCB' }),
    ]);
  });

  test('wrong signature → 97, wrong amount → 04, unknown attempt or merchant → 01; nothing changes', async () => {
    const { buyer, order } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);

    const tampered = { ...callback(attempt), vnp_Amount: '100' };
    expect((await ipn(tampered)).body).toEqual({ RspCode: '97', Message: 'Invalid signature' });
    expect((await ipn(callback(attempt, { amount: 1_000 }))).body.RspCode).toBe('04');
    expect((await ipn(callback({ ...attempt, ref: 'unknownref' }))).body.RspCode).toBe('01');
    expect((await ipn(callback(attempt, { tmnCode: 'OTHERTMN' }))).body.RspCode).toBe('01');
    expect((await ipn({})).body.RspCode).toBe('97');

    expect((await paymentRow(attempt.id)).status).toBe('PENDING');
    expect(await orderStatus(order.id)).toBe('PAYMENT_PENDING');
  });

  test('customer cancelled at VNPay (24) → PAYMENT_FAILED with the reason; a new attempt can pay', async () => {
    const { buyer, order } = await checkedOutOrder();
    const first = await startAttempt(buyer.token, order.id);
    expect((await ipn(callback(first, { code: '24' }))).body.RspCode).toBe('00');
    expect(await paymentRow(first.id)).toMatchObject({ status: 'FAILED', failure_code: '24', provider_transaction_id: null });
    expect(await orderStatus(order.id)).toBe('PAYMENT_FAILED');

    const second = await startAttempt(buyer.token, order.id);
    expect((await ipn(callback(second))).body.RspCode).toBe('00');
    expect(await orderStatus(order.id)).toBe('PAID');
  });

  test('the IPN and the Return URL at the same moment → applied once', async () => {
    const { buyer, order } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    const transactionNo = nextTransactionNo();
    fake.paid(attempt.ref, attempt.amount, transactionNo);
    const params = callback(attempt, { transactionNo });

    const [fromIpn, fromReturn] = await Promise.all([ipn(params), vnpayReturn(buyer.token, params).expect(200)]);
    expect(['00', '02']).toContain(fromIpn.body.RspCode);
    expect(fromReturn.body.data.payment).toMatchObject({ paymentId: attempt.id, orderId: order.id, status: 'SUCCESS' });
    expect(await orderStatus(order.id)).toBe('PAID');
    expect(await ticketCount(order.id)).toBe(1);
    expect(mailbox.count(await emailOf(buyer.id))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Return URL (the customer is back)
// ---------------------------------------------------------------------------

describe('Return URL', () => {
  test('VNPay is asked; its signed reason is kept (24); someone else’s or a forged URL is refused', async () => {
    const { buyer, order } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    const params = callback(attempt, { code: '24' });

    const [stranger] = await createCustomers(1);
    await vnpayReturn(stranger.token, params).expect(404);
    expect((await vnpayReturn(buyer.token, { ...params, vnp_ResponseCode: '00' }).expect(400)).body.error.code).toBe(
      'VALIDATION_ERROR',
    );

    fake.failed(attempt.ref, attempt.amount);
    const res = await vnpayReturn(buyer.token, params).expect(200);
    expect(res.body.data.payment).toMatchObject({ status: 'FAILED', responseCode: '24' });
    expect(await orderStatus(order.id)).toBe('PAYMENT_FAILED');
    expect(fake.state.requests.filter((r) => r.vnp_Command === 'querydr')).toHaveLength(1);
  });

  test('VNPay not answering: still PENDING, nothing decided from the URL alone', async () => {
    const { buyer, order } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    fake.state.down = true;
    const res = await vnpayReturn(buyer.token, callback(attempt)).expect(200);
    expect(res.body.data.payment).toMatchObject({ status: 'PENDING', responseCode: '00' });
    expect(await orderStatus(order.id)).toBe('PAYMENT_PENDING');
  });
});

// ---------------------------------------------------------------------------
// One attempt at a time; late and duplicate money
// ---------------------------------------------------------------------------

describe('a second attempt', () => {
  test('the old one is asked first: unpaid → cancelled; paid → ORDER_ALREADY_PAID; VNPay silent → 503', async () => {
    const { buyer, order } = await checkedOutOrder();
    const first = await startAttempt(buyer.token, order.id);
    const second = await startAttempt(buyer.token, order.id); // VNPay has never seen the first (91)
    expect((await paymentRow(first.id)).status).toBe('CANCELLED');
    expect((await paymentRow(second.id)).status).toBe('PENDING');

    fake.state.down = true;
    expect((await startVnpay(buyer.token, order.id).expect(503)).body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect((await paymentRow(second.id)).status).toBe('PENDING');

    fake.state.down = false;
    fake.paid(second.ref, second.amount);
    expect((await startVnpay(buyer.token, order.id).expect(409)).body.error.code).toBe('ORDER_ALREADY_PAID');
    expect(await orderStatus(order.id)).toBe('PAID');
    expect(await ticketCount(order.id)).toBe(1);
  });

  test('the simulator replaces an open VNPay attempt', async () => {
    const { buyer, order } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    await request(app)
      .post('/api/v1/payments')
      .set(bearer(buyer.token))
      .set('Idempotency-Key', `key-${attempt.id}`)
      .send({ orderId: order.id })
      .expect(201);
    expect((await paymentRow(attempt.id)).status).toBe('CANCELLED');
    expect(await orderStatus(order.id)).toBe('PAID');
  });

  test('paid twice (two tabs): the order keeps one payment, the other is refunded', async () => {
    const { buyer, order } = await checkedOutOrder();
    const first = await startAttempt(buyer.token, order.id);
    const second = await startAttempt(buyer.token, order.id);
    expect((await ipn(callback(second))).body.RspCode).toBe('00');

    const lateNo = nextTransactionNo();
    expect((await ipn(callback(first, { transactionNo: lateNo }))).body.RspCode).toBe('00');
    expect(await paymentRow(first.id)).toMatchObject({ status: 'REFUNDED', provider_transaction_id: lateNo });
    expect(await refundsOf(first.id)).toEqual([expect.objectContaining({ status: 'SUCCESS', amount: 2_000_000, attempts: 1 })]);
    expect(fake.refundsSent()).toEqual([
      expect.objectContaining({ vnp_TxnRef: first.ref, vnp_Amount: '200000000', vnp_TransactionNo: lateNo, vnp_TransactionType: '02' }),
    ]);
    expect(await orderStatus(order.id)).toBe('PAID');
    expect(await ticketCount(order.id)).toBe(1);
    expect(mailbox.subjects(await emailOf(buyer.id))).toContain(`Hoàn tiền thanh toán đơn ${order.orderCode}`);
  });

  test('money for an order that expired meanwhile: refunded, audited, the customer told', async () => {
    const { buyer, order, schedule, seat } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    await makeDue(order.id);
    await payments.reconcileGatewayPayments(); // VNPay never saw it (91) → the order expires
    expect(await orderStatus(order.id)).toBe('EXPIRED');
    expect((await paymentRow(attempt.id)).status).toBe('CANCELLED');
    expect(await seatStatus(schedule.id, seat.A01)).toBe('AVAILABLE');

    expect((await ipn(callback(attempt))).body.RspCode).toBe('00');
    expect((await paymentRow(attempt.id)).status).toBe('REFUNDED');
    expect(await refundsOf(attempt.id)).toEqual([expect.objectContaining({ status: 'SUCCESS', requested_by: 'system' })]);
    expect(await auditActions(order.id)).toContain('LATE_PAYMENT_REFUNDED');
    expect(await orderStatus(order.id)).toBe('EXPIRED');
    expect(await seatStatus(schedule.id, seat.A01)).toBe('AVAILABLE');
    expect(mailbox.latestText(await emailOf(buyer.id))).toContain('2.000.000đ');
    // A repeat of that IPN changes nothing.
    expect((await ipn(callback(attempt))).body.RspCode).toBe('02');
    expect(await refundsOf(attempt.id)).toHaveLength(1);
  });

  test('the customer cancels the order while at VNPay: the attempt is closed with it', async () => {
    const { buyer, order } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    await cancelOrder(app, buyer.token, order.id).expect(200);
    expect((await paymentRow(attempt.id)).status).toBe('CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// Reconciliation (maintenance job)
// ---------------------------------------------------------------------------

describe('reconciliation', () => {
  test('the deadline passes during a VNPay payment: the sweeper waits; VNPay says paid → PAID', async () => {
    const { buyer, order, schedule, seat } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    await makeDue(order.id);
    await expireDueOrders();
    expect(await orderStatus(order.id)).toBe('PAYMENT_PENDING'); // not expired under VNPay's feet

    fake.paid(attempt.ref, attempt.amount);
    await payments.reconcileGatewayPayments();
    expect(await orderStatus(order.id)).toBe('PAID');
    expect(await seatStatus(schedule.id, seat.A01)).toBe('SOLD');
  });

  test('VNPay still open at the deadline → given up, the order expires', async () => {
    const { buyer, order } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    fake.open(attempt.ref, attempt.amount);
    await payments.reconcileGatewayPayments(); // not due yet: not even asked
    expect(fake.state.requests.filter((r) => r.vnp_TxnRef === attempt.ref)).toHaveLength(0);

    await makeDue(order.id);
    await payments.reconcileGatewayPayments();
    expect((await paymentRow(attempt.id)).status).toBe('CANCELLED');
    expect(await orderStatus(order.id)).toBe('EXPIRED');
  });

  test('VNPay silent: asked again each run, given up after the grace period', async () => {
    const { buyer, order, schedule, seat } = await checkedOutOrder();
    const attempt = await startAttempt(buyer.token, order.id);
    await makeDue(order.id);
    fake.state.down = true;
    await payments.reconcileGatewayPayments();
    expect((await paymentRow(attempt.id)).status).toBe('PENDING');
    expect(await orderStatus(order.id)).toBe('PAYMENT_PENDING');
    expect(await seatStatus(schedule.id, seat.A01)).toBe('HELD');

    await query(`UPDATE orders SET expires_at = now() - interval '601 seconds' WHERE id = $1`, [order.id]);
    await payments.reconcileGatewayPayments();
    expect((await paymentRow(attempt.id)).status).toBe('CANCELLED');
    expect(await orderStatus(order.id)).toBe('EXPIRED');
    expect(await seatStatus(schedule.id, seat.A01)).toBe('AVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Refunds through VNPay
// ---------------------------------------------------------------------------

describe('refunds through VNPay', () => {
  test('admin refund: the order is refunded at once, the money sent back by the payments queue', async () => {
    const { order, attempt, transactionNo, schedule, seat } = await paidByVnpay();
    const res = await adminRefund(attempt.id).expect(200);
    expect(res.body.data.payment.status).toBe('REFUNDED');
    expect(await orderStatus(order.id)).toBe('REFUNDED');
    expect(await seatStatus(schedule.id, seat.A01)).toBe('AVAILABLE');

    const [sent] = fake.refundsSent();
    const created = (await paymentRow(attempt.id)).provider_create_date;
    expect(sent).toMatchObject({
      vnp_TxnRef: attempt.ref,
      vnp_Amount: '200000000',
      vnp_TransactionNo: transactionNo,
      vnp_TransactionDate: created,
      vnp_CreateBy: admin.id.replace(/-/g, ''),
    });
    const [refund] = await refundsOf(attempt.id);
    expect(refund).toMatchObject({ status: 'SUCCESS', attempts: 1, failure_message: null, requested_by: admin.id });
    expect(refund.provider_refund_id).toBeTruthy();

    const detail = await request(app).get(`/api/v1/orders/${order.id}`).set(bearer(admin.token)).expect(200);
    expect(detail.body.data.order.refunds).toEqual([expect.objectContaining({ id: refund.id, status: 'SUCCESS', amount: 2_000_000 })]);
  });

  test('VNPay down: retried by the queue, FAILED after the last try; an admin sends it again', async () => {
    const { buyer, order, attempt } = await paidByVnpay();
    fake.state.down = true;
    await adminRefund(attempt.id).expect(200);
    let [refund] = await refundsOf(attempt.id);
    expect(refund).toMatchObject({ status: 'PENDING', attempts: 1 }); // the job threw: BullMQ would try again

    // BullMQ's last try.
    expect(await payments.processVnpayRefund({ refundId: refund.id }, { attemptsMade: 4, opts: { attempts: 5 } })).toBe('failed');
    [refund] = await refundsOf(attempt.id);
    expect(refund).toMatchObject({ status: 'FAILED', attempts: 2 });
    expect(refund.failure_message).toContain('VNPay không trả lời');
    expect(await auditActions(refund.id)).toEqual(['REFUND_FAILED']);

    const retry = () => request(app).post(`/api/v1/payments/refunds/${refund.id}/retry`);
    await retry().set(bearer(buyer.token)).expect(403);
    fake.state.down = false;
    const res = await retry().set(bearer(admin.token)).expect(200);
    expect(res.body.data.refund).toEqual({ refundId: refund.id, orderId: order.id, status: 'PENDING' });
    [refund] = await refundsOf(attempt.id);
    expect(refund).toMatchObject({ status: 'SUCCESS', attempts: 3, failure_message: null });
    expect(await auditActions(order.id)).toContain('REFUND_RETRIED');

    expect((await retry().set(bearer(admin.token)).expect(409)).body.error.code).toBe('REFUND_NOT_RETRYABLE');
  });

  test('VNPay refuses for good (95) → FAILED at once, with its reason', async () => {
    const { attempt } = await paidByVnpay();
    fake.state.refundCode = '95';
    await adminRefund(attempt.id).expect(200);
    const [refund] = await refundsOf(attempt.id);
    expect(refund).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(refund.failure_message).toContain('mã 95');
  });

  test('cancelling the event: VNPay orders refunded through the queue, open attempts closed', async () => {
    const { event, schedule, seat, order: paid, attempt } = await paidByVnpay();
    const [other] = await createCustomers(1);
    const open = (await book(app, other.token, schedule.id, { seatIds: [seat.A02] }).expect(201)).body.data.order;
    await request(app).post(`/api/v1/orders/${open.id}/checkout`).set(bearer(other.token)).send({}).expect(200);
    const openAttempt = await startAttempt(other.token, open.id);

    await changeStatus(app, organizer.token, event.id, 'CANCELLED', 'Storm warning').expect(200);
    expect(await orderStatus(paid.id)).toBe('REFUNDED');
    expect(await refundsOf(attempt.id)).toEqual([expect.objectContaining({ status: 'SUCCESS', requested_by: organizer.id })]);
    expect(await orderStatus(open.id)).toBe('CANCELLED');
    expect((await paymentRow(openAttempt.id)).status).toBe('CANCELLED');
  });
});

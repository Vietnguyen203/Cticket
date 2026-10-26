const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const mailer = require('../../src/mail/mailer');
const { useFakeMailbox, registerUser } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, cancelOrder, makeDue } = require('../helpers/orders');
const { QUEUE, enqueue, getQueue, setQueueMode } = require('../../src/queue/queues');
const processors = require('../../src/queue/processors');
const { startWorkers, MAINTENANCE_SCHEDULE } = require('../../src/worker');
const { findInventoryMismatches } = require('../../src/modules/orders');
const { TERMS_VERSION } = require('../../src/config/constants');

const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizer;
let category;
let workers;

beforeAll(async () => {
  admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  category = await createCategory(app, admin.token);
  // From here on: real BullMQ queues, processed by real workers in this process.
  setQueueMode('bullmq');
  workers = await startWorkers({ schedule: false });
});
afterAll(async () => {
  await workers?.stop();
  setQueueMode('inline');
  await closePool();
});
afterEach(async () => {
  expect(await findInventoryMismatches(pool)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitFor(check, { timeoutMs = 8000, what = 'condition' } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function onSale() {
  const world = await createConfiguredEvent(app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
  });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

const checkout = (token, orderId) => request(app).post(`/api/v1/orders/${orderId}/checkout`).set(bearer(token)).send({ termsVersion: TERMS_VERSION });
const pay = (token, orderId) =>
  request(app).post('/api/v1/payments').set(bearer(token)).set('Idempotency-Key', randomUUID()).send({ orderId });

/** 2 seats + 3 standing tickets, checked out and paid. */
async function paidOrder() {
  const world = await onSale();
  const [buyer] = await createCustomers(1);
  const { order } = (
    await book(app, buyer.token, world.schedule.id, {
      seatIds: [world.seat.A01, world.seat.A02],
      items: [{ ticketTypeId: world.standing.id, quantity: 3 }],
    }).expect(201)
  ).body.data;
  await checkout(buyer.token, order.id).expect(200);
  const { payment } = (await pay(buyer.token, order.id).expect(201)).body.data;
  return { ...world, buyer, order, payment };
}

const ticketCount = async (orderId) =>
  (await query(`SELECT count(*)::int AS n FROM tickets WHERE order_id = $1`, [orderId])).rows[0].n;
const orderStatus = async (orderId) => (await query(`SELECT status FROM orders WHERE id = $1`, [orderId])).rows[0].status;
const emailOf = async (userId) => (await query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0].email;

// ---------------------------------------------------------------------------
// Q-01, Q-04: tickets
// ---------------------------------------------------------------------------

describe('issuing tickets (Q-01)', () => {
  test('paying makes the worker issue one ticket per seat and N per GA line, then email them', async () => {
    const { buyer, order } = await paidOrder();
    await waitFor(async () => (await ticketCount(order.id)) === 5, { what: '5 tickets' });

    const email = await emailOf(buyer.id);
    await waitFor(() => mailbox.count(email) === 1, { what: 'the confirmation email' });
    const detail = await request(app).get(`/api/v1/orders/${order.id}`).set(bearer(buyer.token)).expect(200);
    const tickets = detail.body.data.order.tickets;
    expect(tickets).toHaveLength(5);
    expect(tickets.every((t) => /^TKT-[A-HJ-NP-Z2-9]{10}$/.test(t.code) && t.status === 'VALID')).toBe(true);
    expect(tickets.filter((t) => t.seatLabel).map((t) => t.seatLabel)).toEqual(['Khu A - A01', 'Khu A - A02']);
    expect(tickets.filter((t) => !t.seatLabel).map((t) => t.admissionNo)).toEqual([1, 2, 3]);

    // Running the job again (a retry, the reconciliation) issues nothing more.
    for (let i = 0; i < 3; i += 1) {
      expect(await processors.run(QUEUE.TICKETS, { name: 'issue', data: { orderId: order.id } })).toBe(0);
    }
    expect(await ticketCount(order.id)).toBe(5);
  });

  test('Q-04: a lost enqueue is caught by the reconciliation job', async () => {
    const queue = getQueue(QUEUE.TICKETS);
    const add = jest.spyOn(queue, 'add').mockRejectedValueOnce(new Error('Connection is closed.'));
    const { order } = await paidOrder();
    add.mockRestore();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await ticketCount(order.id)).toBe(0); // the job never reached Redis

    // The reconciliation leaves fresh payments to the normal job: make this one a minute old.
    await query(`UPDATE orders SET paid_at = now() - interval '2 minutes' WHERE id = $1`, [order.id]);
    expect(await processors.run(QUEUE.MAINTENANCE, { name: 'reconcile-tickets', data: {} })).toBeGreaterThanOrEqual(1);
    await waitFor(async () => (await ticketCount(order.id)) === 5, { what: 'reconciled tickets' });
  });

  test('refunded before the worker ran → no tickets; refunded after → tickets REFUNDED', async () => {
    const queue = getQueue(QUEUE.TICKETS);
    const add = jest.spyOn(queue, 'add').mockRejectedValueOnce(new Error('Connection is closed.'));
    const early = await paidOrder();
    add.mockRestore();
    await request(app).post(`/api/v1/payments/${early.payment.id}/refund`).set(bearer(admin.token)).send({ reason: 'Early' }).expect(200);
    expect(await processors.run(QUEUE.TICKETS, { name: 'issue', data: { orderId: early.order.id } })).toBe(0);

    const late = await paidOrder();
    await waitFor(async () => (await ticketCount(late.order.id)) === 5, { what: 'tickets' });
    await request(app).post(`/api/v1/payments/${late.payment.id}/refund`).set(bearer(admin.token)).send({ reason: 'Late' }).expect(200);
    const { rows } = await query(`SELECT DISTINCT status FROM tickets WHERE order_id = $1`, [late.order.id]);
    expect(rows).toEqual([{ status: 'REFUNDED' }]);
  });
});

// ---------------------------------------------------------------------------
// Q-02: emails
// ---------------------------------------------------------------------------

describe('emails through the queue (Q-02)', () => {
  test('SMTP fails twice, then works: the code arrives on the third attempt', async () => {
    const sendMail = jest.spyOn(mailer, 'sendMail'); // the fake mailbox's mock
    sendMail.mockRejectedValueOnce(new Error('SMTP down')).mockRejectedValueOnce(new Error('SMTP down'));

    const { email } = await registerUser(app);
    await waitFor(() => mailbox.count(email) === 3, { what: 'three attempts' });
    // The last attempt delivered a working code.
    const user = await query(`SELECT status FROM users WHERE email = $1`, [email]);
    expect(user.rows[0].status).toBe('PENDING_VERIFICATION');
    await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ email, purpose: 'EMAIL_VERIFICATION', otp: mailbox.latestOtp(email) })
      .expect(200);
  });

  test('SMTP never works: the job ends up failed, nothing else is affected', async () => {
    const emails = getQueue(QUEUE.EMAILS);
    const failedBefore = await emails.getFailedCount();
    const sendMail = jest.spyOn(mailer, 'sendMail');
    sendMail.mockRejectedValue(new Error('SMTP down'));
    try {
      const { res } = await registerUser(app);
      expect(res.status).toBe(201); // the request never waited for SMTP
      await waitFor(async () => (await emails.getFailedCount()) === failedBefore + 1, { what: 'a failed job' });
    } finally {
      sendMail.mockResolvedValue(undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// Q-03: timed expiry
// ---------------------------------------------------------------------------

describe('timed hold expiry (Q-03)', () => {
  test('booking schedules a job at the deadline; the job expires the order', async () => {
    const { schedule, seat } = await onSale();
    const [buyer] = await createCustomers(1);
    const { order } = (await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] }).expect(201)).body.data;

    const deadline = new Date(order.expiresAt).getTime();
    const job = await getQueue(QUEUE.HOLDS).getJob(`expire-${order.id}-${deadline}`);
    expect(job).toBeTruthy();
    expect(job.opts.delay).toBeGreaterThan(9 * 60_000); // ~10 minutes

    // Fast-forward: the deadline has passed and the job fires.
    await makeDue(order.id);
    await enqueue(QUEUE.HOLDS, 'expire', { orderId: order.id }, { jobId: `expire-${order.id}-now` });
    await waitFor(async () => (await orderStatus(order.id)) === 'EXPIRED', { what: 'EXPIRED' });
  });

  test('a job for an earlier deadline does not expire an order that checkout extended', async () => {
    const { schedule, seat } = await onSale();
    const [buyer] = await createCustomers(1);
    const { order } = (await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] }).expect(201)).body.data;
    await checkout(buyer.token, order.id).expect(200);

    const jobId = `expire-${order.id}-early`;
    await enqueue(QUEUE.HOLDS, 'expire', { orderId: order.id }, { jobId });
    await waitFor(async () => (await (await getQueue(QUEUE.HOLDS).getJob(jobId))?.getState()) === 'completed', {
      what: 'the early job',
    });
    expect(await orderStatus(order.id)).toBe('PAYMENT_PENDING');
    await cancelOrder(app, buyer.token, order.id).expect(200);
  });
});

// ---------------------------------------------------------------------------
// Q-05, NOT-01: notifications
// ---------------------------------------------------------------------------

describe('in-app notifications (Q-05, NOT-01)', () => {
  test('a cancelled order notifies its owner; read, read all; nobody else sees it', async () => {
    const { schedule, seat } = await onSale();
    const [buyer, stranger] = await createCustomers(2);
    const { order } = (await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] }).expect(201)).body.data;
    await cancelOrder(app, buyer.token, order.id).expect(200);

    const list = await waitFor(
      async () => {
        const res = await request(app).get('/api/v1/notifications').set(bearer(buyer.token)).expect(200);
        return res.body.data.notifications.length > 0 ? res.body.data : null;
      },
      { what: 'a notification' },
    );
    expect(list.unreadCount).toBe(1);
    const [notification] = list.notifications;
    expect(notification).toMatchObject({ type: 'ORDER_CANCELLED', title: 'Đơn hàng đã bị hủy', readAt: null });
    expect(notification.message).toContain(order.orderCode);

    await request(app).patch(`/api/v1/notifications/${notification.id}/read`).set(bearer(stranger.token)).expect(404);
    const read = await request(app).patch(`/api/v1/notifications/${notification.id}/read`).set(bearer(buyer.token)).expect(200);
    expect(read.body.data.notification.readAt).toBeTruthy();
    await request(app).post('/api/v1/notifications/read-all').set(bearer(buyer.token)).expect(200);
    const after = await request(app).get('/api/v1/notifications?unread=true').set(bearer(buyer.token)).expect(200);
    expect(after.body.data).toMatchObject({ notifications: [], unreadCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// Maintenance: after the show, schedulers
// ---------------------------------------------------------------------------

describe('maintenance jobs', () => {
  test('after the show: schedule and event FINISHED, paid order COMPLETED', async () => {
    const { event, schedule, order } = await paidOrder();
    await query(
      `UPDATE event_schedules
       SET sales_start_at = now() - interval '3 days', sales_end_at = now() - interval '2 days',
           start_at = now() - interval '2 days', end_at = now() - interval '1 day'
       WHERE id = $1`,
      [schedule.id],
    );
    await processors.run(QUEUE.MAINTENANCE, { name: 'finish-shows', data: {} });

    const { rows } = await query(
      `SELECT (SELECT status FROM event_schedules WHERE id = $1) AS schedule,
              (SELECT status FROM events WHERE id = $2) AS event,
              (SELECT status FROM orders WHERE id = $3) AS "order"`,
      [schedule.id, event.id, order.id],
    );
    expect(rows[0]).toEqual({ schedule: 'FINISHED', event: 'FINISHED', order: 'COMPLETED' });
  });

  test('the worker registers the repeatable maintenance jobs', async () => {
    const maintenance = getQueue(QUEUE.MAINTENANCE);
    const extra = await startWorkers({ schedule: true });
    try {
      const schedulers = await maintenance.getJobSchedulers();
      expect(schedulers.map((s) => s.key ?? s.name).sort()).toEqual(MAINTENANCE_SCHEDULE.map((s) => s.name).sort());
    } finally {
      for (const { name } of MAINTENANCE_SCHEDULE) await maintenance.removeJobScheduler(name);
      await extra.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// INF-07: graceful shutdown (runs last: it stops the workers)
// ---------------------------------------------------------------------------

describe('worker shutdown (INF-07)', () => {
  test('stop() lets a running job finish before returning', async () => {
    let finished = false;
    jest.spyOn(mailer, 'sendMail').mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => { finished = true; resolve(); }, 500)),
    );
    const jobId = `otp-slow-${Date.now()}`;
    await enqueue(QUEUE.EMAILS, 'otp', { to: 'slow@example.com', firstName: null, purpose: 'EMAIL_VERIFICATION', code: '123456' }, { jobId, removeOnComplete: false });
    await waitFor(async () => (await (await getQueue(QUEUE.EMAILS).getJob(jobId))?.getState()) === 'active', { what: 'an active job' });

    await workers.stop();
    workers = null;
    expect(finished).toBe(true);
    expect(await (await getQueue(QUEUE.EMAILS).getJob(jobId)).getState()).toBe('completed');
  });
});

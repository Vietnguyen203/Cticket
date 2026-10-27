const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const { useFakeMailbox, createLoggedInUser, login, registerUser } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { book } = require('../helpers/orders');
const { findInventoryMismatches } = require('../../src/modules/orders');
const { TERMS_VERSION } = require('../../src/config/constants');

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

const me = (token) => request(app).get('/api/v1/users/me').set(bearer(token));
const exportData = (token) => request(app).get('/api/v1/users/me/data').set(bearer(token));
const check = (token) => request(app).get('/api/v1/users/me/deletion').set(bearer(token));
const deleteMe = (token, password) => request(app).delete('/api/v1/users/me').set(bearer(token)).send({ password });

/** A real (password) customer with a paid ticket for seat A01 of a show in 30 days. */
async function customerWithTicket() {
  const user = await createLoggedInUser(app, mailbox);
  const token = user.session.accessToken;
  const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  const seat = world.seats.find((s) => s.code === 'A01').id;
  const { order } = (await book(app, token, world.schedule.id, { seatIds: [seat] }).expect(201)).body.data;
  await request(app).post(`/api/v1/orders/${order.id}/checkout`).set(bearer(token)).send({ termsVersion: TERMS_VERSION }).expect(200);
  await request(app).post('/api/v1/payments').set(bearer(token)).set('Idempotency-Key', randomUUID()).send({ orderId: order.id }).expect(201);
  return { ...user, token, world, order };
}

/** The show is over: its tickets no longer keep the account. */
const endShow = (scheduleId) =>
  query(
    `UPDATE event_schedules SET start_at = now() - interval '3 days', end_at = now() - interval '3 days' + interval '2 hours',
            sales_start_at = now() - interval '10 days', sales_end_at = now() - interval '4 days'
     WHERE id = $1`,
    [scheduleId],
  );

describe('my personal data (export)', () => {
  test('everything about me, the terms I accepted, and no secret', async () => {
    const { token, email, order } = await customerWithTicket();
    const res = await exportData(token).expect(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="etp-du-lieu-ca-nhan-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers['cache-control']).toBe('no-store');

    const { data } = res.body.data;
    expect(data.account).toMatchObject({ email, status: 'ACTIVE', roles: ['CUSTOMER'] });
    expect(data.sessions.length).toBeGreaterThan(0);
    expect(data.orders).toEqual([
      expect.objectContaining({
        orderCode: order.orderCode,
        status: 'PAID',
        items: [expect.objectContaining({ seat: expect.stringContaining('A01'), unitPrice: 2_000_000 })],
        termsOfSale: { version: TERMS_VERSION, acceptedAt: expect.any(String), refundPolicy: null },
        payments: [expect.objectContaining({ status: 'SUCCESS', amount: 2_000_000 })],
      }),
    ]);
    expect(data.tickets).toEqual([expect.objectContaining({ ticketCode: expect.stringMatching(/^TKT-/), status: 'VALID' })]);
    // Secrets never leave: password hash, QR token (hash), two-factor secret.
    expect(JSON.stringify(data)).not.toMatch(/password|qr_token|qrToken|secret_encrypted|\$2[aby]\$/);
  });
});

describe('deleting my account', () => {
  test('blocked while it still has a ticket to come, an open order, or the admin role', async () => {
    const { token } = await customerWithTicket();
    expect((await check(token).expect(200)).body.data.deletion).toEqual({ allowed: false, reasons: ['UPCOMING_TICKETS'] });

    const held = await createLoggedInUser(app, mailbox);
    const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
    await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
    await book(app, held.session.accessToken, world.schedule.id, { seatIds: [world.seats[0].id] }).expect(201);
    const refused = await deleteMe(held.session.accessToken, held.password);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'ACCOUNT_DELETION_BLOCKED', details: { reasons: ['OPEN_ORDER'] } });
    expect((await me(held.session.accessToken)).status).toBe(200); // nothing happened

    expect((await check(admin.token).expect(200)).body.data.deletion.reasons).toContain('ADMIN');
  });

  test('the password is required; a wrong one changes nothing', async () => {
    const user = await createLoggedInUser(app, mailbox);
    expect((await deleteMe(user.session.accessToken, 'Wrong-pass-1')).body.error.code).toBe('WRONG_PASSWORD');
    expect((await deleteMe(user.session.accessToken, '')).status).toBe(400);
    expect((await me(user.session.accessToken)).status).toBe(200);
  });

  test('personal data removed, sessions ended at once, orders kept anonymised, the email free again', async () => {
    const { token, email, password, session, world, order } = await customerWithTicket();
    await endShow(world.schedule.id);
    const userId = (await query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id;
    await query(`INSERT INTO reviews (user_id, event_id, order_id, rating, comment) VALUES ($1, $2, $3, 4, 'Tên tôi là An')`, [
      userId,
      world.event.id,
      order.id,
    ]);
    expect((await check(token).expect(200)).body.data.deletion).toEqual({ allowed: true, reasons: [] });

    await deleteMe(token, password).expect(200);

    // Signed out everywhere, now: this access token, the refresh token, the password.
    expect((await me(token)).body.error.code).toBe('TOKEN_REVOKED');
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken })).status).toBe(401);
    expect((await login(app, email, password)).body.error.code).toBe('INVALID_CREDENTIALS');

    const { rows } = await query(`SELECT email, first_name, last_name, phone, status, deleted_at FROM users WHERE id = $1`, [userId]);
    expect(rows[0]).toMatchObject({
      email: `deleted-${userId}@deleted.invalid`,
      first_name: 'Người dùng',
      last_name: 'đã xóa',
      phone: null,
      status: 'DELETED',
    });
    expect(rows[0].deleted_at).not.toBeNull();
    const counts = (
      await query(
        `SELECT (SELECT count(*) FROM refresh_tokens WHERE user_id = $1)::int AS sessions,
                (SELECT count(*) FROM user_roles WHERE user_id = $1)::int AS roles,
                (SELECT count(*) FROM orders WHERE user_id = $1 AND status = 'PAID')::int AS paid_orders,
                (SELECT comment FROM reviews WHERE user_id = $1) AS comment,
                (SELECT rating FROM reviews WHERE user_id = $1) AS rating`,
        [userId],
      )
    ).rows[0];
    expect(counts).toEqual({ sessions: 0, roles: 0, paid_orders: 1, comment: null, rating: 4 });
    const audit = await query(`SELECT 1 FROM audit_logs WHERE action = 'ACCOUNT_DELETED' AND entity_id = $1`, [userId]);
    expect(audit.rowCount).toBe(1);

    // The address can sign up again, as a new person.
    expect((await registerUser(app, { email })).res.status).toBe(201);

    // An admin cannot bring the deleted account back.
    const reactivate = await request(app).patch(`/api/v1/admin/users/${userId}/status`).set(bearer(admin.token)).send({ status: 'ACTIVE' });
    expect(reactivate.body.error.code).toBe('ACCOUNT_DELETED');
  });
});

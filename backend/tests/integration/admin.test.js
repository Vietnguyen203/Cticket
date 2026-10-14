const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { useFakeMailbox, createLoggedInUser, login, DEFAULT_PASSWORD } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory, createVenue, createPublishedEvent } = require('../helpers/catalog');
const { createCustomers, book } = require('../helpers/orders');

const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let category;

beforeAll(async () => {
  admin = await createAdmin(app);
  category = await createCategory(app, admin.token);
});
afterAll(() => closePool());

const asAdmin = (req) => req.set(bearer(admin.token));
const setStatus = (token, userId, body) => request(app).patch(`/api/v1/admin/users/${userId}/status`).set(bearer(token)).send(body);
const setRoles = (token, userId, roles) => request(app).put(`/api/v1/admin/users/${userId}/roles`).set(bearer(token)).send({ roles });
const me = (token) => request(app).get('/api/v1/users/me').set(bearer(token));
const userIdOf = async (email) => (await query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id;

describe('users (USR-03, USR-04, USR-05)', () => {
  test('search by email, filter by role; never a password hash', async () => {
    const organizer = await createOrganizer(app, mailbox, admin.token);
    const res = await asAdmin(request(app).get(`/api/v1/admin/users?q=${encodeURIComponent(organizer.email)}`)).expect(200);
    expect(res.body.data.users).toEqual([
      expect.objectContaining({ email: organizer.email, status: 'ACTIVE', roles: ['CUSTOMER', 'ORGANIZER'] }),
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const organizers = await asAdmin(request(app).get('/api/v1/admin/users?role=ORGANIZER&pageSize=50')).expect(200);
    expect(organizers.body.data.users.every((u) => u.roles.includes('ORGANIZER'))).toBe(true);

    const [customer] = await createCustomers(1);
    await request(app).get('/api/v1/admin/users').set(bearer(customer.token)).expect(403);
  });

  test('suspending logs the user out at once; reactivating lets them back in; both audited', async () => {
    const user = await createLoggedInUser(app, mailbox);
    const userId = await userIdOf(user.email);
    await me(user.session.accessToken).expect(200);

    const noReason = await setStatus(admin.token, userId, { status: 'SUSPENDED' }).expect(400);
    expect(noReason.body.error.details[0].field).toBe('body.reason');
    const res = await setStatus(admin.token, userId, { status: 'SUSPENDED', reason: 'Spam bán lại vé' }).expect(200);
    expect(res.body.data.user.status).toBe('SUSPENDED');

    expect((await me(user.session.accessToken)).body.error.code).toBe('TOKEN_REVOKED'); // not in 15 minutes: now
    const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.session.refreshToken });
    expect(refresh.status).toBe(401);
    expect((await login(app, user.email, DEFAULT_PASSWORD)).body.error.code).toBe('ACCOUNT_DISABLED');

    await setStatus(admin.token, userId, { status: 'ACTIVE' }).expect(200);
    await login(app, user.email, DEFAULT_PASSWORD).expect(200);

    const audit = await asAdmin(request(app).get(`/api/v1/admin/audit-logs?entityId=${userId}`)).expect(200);
    expect(audit.body.data.auditLogs.map((a) => a.action)).toEqual(['USER_REACTIVATED', 'USER_SUSPENDED']);
    expect(audit.body.data.auditLogs[1]).toMatchObject({ userEmail: admin.email, newValue: { status: 'SUSPENDED', reason: 'Spam bán lại vé' } });
  });

  test('roles: CUSTOMER always kept; a removed role is gone at once, an added one at the next refresh', async () => {
    const organizer = await createOrganizer(app, mailbox, admin.token);
    const userId = await userIdOf(organizer.email);

    const res = await setRoles(admin.token, userId, ['STAFF']).expect(200);
    expect(res.body.data.user.roles).toEqual(['CUSTOMER', 'STAFF']);
    // ORGANIZER was removed: the old token (which still says ORGANIZER) no longer works.
    expect((await me(organizer.token)).body.error.code).toBe('TOKEN_REVOKED');
    const fresh = await login(app, organizer.email, DEFAULT_PASSWORD).expect(200);
    expect(fresh.body.data.user.roles).toEqual(['CUSTOMER', 'STAFF']);
  });

  test('granting ORGANIZER makes a usable organizer: a profile is created, events can be made after the refresh', async () => {
    const user = await createLoggedInUser(app, mailbox);
    const id = await userIdOf(user.email);
    await setRoles(admin.token, id, ['ORGANIZER']).expect(200);

    const { rows } = await query(`SELECT id, organization_name, status FROM organizers WHERE user_id = $1`, [id]);
    expect(rows).toEqual([expect.objectContaining({ organization_name: 'Nguyen Lan', status: 'ACTIVE' })]);
    const audit = await query(`SELECT action FROM audit_logs WHERE entity_id = $1`, [rows[0].id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['ORGANIZER_CREATED']);

    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.session.refreshToken }).expect(200);
    const category = await createCategory(app, admin.token);
    await request(app)
      .post('/api/v1/events')
      .set(bearer(refreshed.body.data.accessToken))
      .send({ title: `Granted ${randomUUID().slice(0, 6)}`, categoryIds: [category.id] })
      .expect(201);

    // Saving the same roles again changes nothing (no second profile, no second audit line).
    await setRoles(admin.token, id, ['ORGANIZER']).expect(200);
    expect((await query(`SELECT count(*)::int AS n FROM organizers WHERE user_id = $1`, [id])).rows[0].n).toBe(1);
  });

  test('granting ORGANIZER approves a pending application', async () => {
    const user = await createLoggedInUser(app, mailbox);
    const applied = await request(app)
      .post('/api/v1/organizers')
      .set(bearer(user.session.accessToken))
      .send({ organizationName: 'Công ty Sự kiện Chờ duyệt' })
      .expect(201);
    expect(applied.body.data.organizer.status).toBe('PENDING');

    await setRoles(admin.token, await userIdOf(user.email), ['ORGANIZER', 'STAFF']).expect(200);
    const { rows } = await query(`SELECT organization_name, status FROM organizers WHERE id = $1`, [applied.body.data.organizer.id]);
    expect(rows[0]).toEqual({ organization_name: 'Công ty Sự kiện Chờ duyệt', status: 'ACTIVE' });
    const audit = await query(`SELECT action, old_value FROM audit_logs WHERE entity_id = $1`, [applied.body.data.organizer.id]);
    expect(audit.rows).toEqual([{ action: 'ORGANIZER_APPROVED', old_value: { status: 'PENDING' } }]);
  });

  test('an admin cannot suspend or demote themselves', async () => {
    const adminId = await userIdOf(admin.email);
    expect((await setStatus(admin.token, adminId, { status: 'SUSPENDED', reason: 'thử' })).body.error.code).toBe('CANNOT_CHANGE_SELF');
    expect((await setRoles(admin.token, adminId, [])).body.error.code).toBe('CANNOT_CHANGE_SELF');
  });

  test('two admins removing each other at the same moment: the platform keeps one', async () => {
    const a = await createAdmin(app);
    const b = await createAdmin(app);
    const [aId, bId] = [await userIdOf(a.email), await userIdOf(b.email)];
    // Leave A and B as the only active admins for this test.
    const others = (
      await query(
        `SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
         WHERE r.code = 'ADMIN' AND u.status = 'ACTIVE' AND ur.user_id <> ALL($1::uuid[])`,
        [[aId, bId]],
      )
    ).rows.map((row) => row.user_id);
    await query(`UPDATE users SET status = 'SUSPENDED' WHERE id = ANY($1::uuid[])`, [others]);
    try {
      const results = await Promise.all([setRoles(a.token, bId, []), setRoles(b.token, aId, [])]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409).body.error.code).toBe('LAST_ADMIN');
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.code = 'ADMIN' AND ur.user_id = ANY($1::uuid[])`,
        [[aId, bId]],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await query(`UPDATE users SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [others]);
    }
  });
});

describe('audit log (AUD-02)', () => {
  test('filters and the list of actions; read with audit:read only', async () => {
    const actions = await asAdmin(request(app).get('/api/v1/admin/audit-logs/actions')).expect(200);
    // The user tests above suspended someone and changed roles.
    expect(actions.body.data.actions).toEqual(expect.arrayContaining(['USER_SUSPENDED', 'USER_ROLES_CHANGED']));
    const onlyRoles = await asAdmin(request(app).get('/api/v1/admin/audit-logs?action=USER_ROLES_CHANGED')).expect(200);
    expect(onlyRoles.body.data.auditLogs.length).toBeGreaterThan(0);
    expect(onlyRoles.body.data.auditLogs.every((log) => log.action === 'USER_ROLES_CHANGED')).toBe(true);
    const page = await asAdmin(request(app).get('/api/v1/admin/audit-logs?pageSize=5')).expect(200);
    expect(page.body.meta).toMatchObject({ page: 1, pageSize: 5 });
    expect(page.body.data.auditLogs.length).toBeLessThanOrEqual(5);

    const organizer = await createOrganizer(app, mailbox, admin.token);
    await request(app).get('/api/v1/admin/audit-logs').set(bearer(organizer.token)).expect(403);
  });
});

describe('orders and tickets (ORD-05, TKT-03)', () => {
  async function paidTicket() {
    const organizer = await createOrganizer(app, mailbox, admin.token);
    const venue = await createVenue(app, admin.token);
    const event = await createPublishedEvent(app, { organizer, adminToken: admin.token, categoryIds: [category.id], venueId: venue.id });
    const [buyer] = await createCustomers(1);
    const ga = (await request(app).get(`/api/v1/schedules/${event.schedules[0].id}/ticket-types`).expect(200)).body.data.ticketTypes[0];
    const { order } = (await book(app, buyer.token, event.schedules[0].id, { items: [{ ticketTypeId: ga.id, quantity: 1 }] }).expect(201)).body.data;
    await request(app).post(`/api/v1/orders/${order.id}/checkout`).set(bearer(buyer.token)).send({}).expect(200);
    const { payment } = (
      await request(app).post('/api/v1/payments').set(bearer(buyer.token)).set('Idempotency-Key', randomUUID()).send({ orderId: order.id }).expect(201)
    ).body.data;
    const [ticket] = (await request(app).get('/api/v1/tickets').set(bearer(buyer.token)).expect(200)).body.data.tickets;
    return { buyer, order, payment, ticket };
  }

  test('admins find orders by code or buyer email', async () => {
    const { buyer, order } = await paidTicket();
    const email = (await query(`SELECT email FROM users WHERE id = $1`, [buyer.id])).rows[0].email;
    for (const q of [email, order.orderCode.slice(0, 8)]) {
      const res = await asAdmin(request(app).get(`/api/v1/orders?all=true&q=${encodeURIComponent(q)}`)).expect(200);
      expect(res.body.data.orders.map((o) => o.id)).toContain(order.id);
      expect(res.body.data.orders.find((o) => o.id === order.id).buyerEmail).toBe(email);
    }
  });

  test('reissuing a QR retires the old one; a refunded ticket cannot be reissued', async () => {
    const { buyer, ticket, payment } = await paidTicket();
    const before = (await request(app).get(`/api/v1/tickets/${ticket.id}`).set(bearer(buyer.token))).body.data.ticket.qrToken;

    await asAdmin(request(app).post(`/api/v1/admin/tickets/${ticket.id}/reissue-qr`)).expect(200);
    const after = (await request(app).get(`/api/v1/tickets/${ticket.id}`).set(bearer(buyer.token))).body.data.ticket.qrToken;
    expect(after).not.toBe(before);
    expect(after.split('.')[1]).toBe('2');
    await request(app).post(`/api/v1/admin/tickets/${ticket.id}/reissue-qr`).set(bearer(buyer.token)).expect(403);

    await asAdmin(request(app).post(`/api/v1/payments/${payment.id}/refund`)).send({ reason: 'Khách hủy' }).expect(200);
    const res = await asAdmin(request(app).post(`/api/v1/admin/tickets/${ticket.id}/reissue-qr`)).expect(409);
    expect(res.body.error.code).toBe('TICKET_NOT_REISSUABLE');
  });
});

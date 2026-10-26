const { randomUUID, createHmac } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const { signAccessToken } = require('../../src/modules/auth/auth.tokens');
const { qrToken, qrTokenHash } = require('../../src/modules/tickets/qr');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory, changeStatus } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book } = require('../helpers/orders');
const { startServer, connect } = require('../helpers/ws');
const { findInventoryMismatches } = require('../../src/modules/orders');
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

const checkout = (token, orderId) => request(app).post(`/api/v1/orders/${orderId}/checkout`).set(bearer(token)).send({ termsVersion: TERMS_VERSION });
const pay = (token, orderId) =>
  request(app).post('/api/v1/payments').set(bearer(token)).set('Idempotency-Key', randomUUID()).send({ orderId });
const scan = (token, body) => request(app).post('/api/v1/check-ins').set(bearer(token)).send(body);
const myTickets = async (token, queryString = '') =>
  (await request(app).get(`/api/v1/tickets${queryString}`).set(bearer(token)).expect(200)).body.data.tickets;
const qrOf = async (token, ticketId) =>
  (await request(app).get(`/api/v1/tickets/${ticketId}`).set(bearer(token)).expect(200)).body.data.ticket.qrToken;
const checkInCount = async (ticketId) =>
  (await query(`SELECT count(*)::int AS n FROM check_ins WHERE ticket_id = $1`, [ticketId])).rows[0].n;
const ticketStatus = async (ticketId) => (await query(`SELECT status FROM tickets WHERE id = $1`, [ticketId])).rows[0].status;
const orderStatus = async (orderId) => (await query(`SELECT status FROM orders WHERE id = $1`, [orderId])).rows[0].status;

/**
 * A PUBLISHED event 30 days ahead, and a buyer who paid for A01, A02 (CAT 1)
 * and 3 standing tickets: 5 tickets, issued inline by the paid order.
 */
async function paidTickets() {
  const world = await createConfiguredEvent(app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
  });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  const seat = Object.fromEntries(world.seats.map((s) => [s.code, s.id]));
  const [buyer] = await createCustomers(1);
  const { order } = (
    await book(app, buyer.token, world.schedule.id, {
      seatIds: [seat.A01, seat.A02],
      items: [{ ticketTypeId: world.standing.id, quantity: 3 }],
    }).expect(201)
  ).body.data;
  await checkout(buyer.token, order.id).expect(200);
  const { payment } = (await pay(buyer.token, order.id).expect(201)).body.data;
  const tickets = await myTickets(buyer.token);
  expect(tickets).toHaveLength(5);
  return { ...world, seat, buyer, order, payment, tickets };
}

/** Move the show so that it starts in `startsInMinutes` (negative: it has started). */
async function moveShow(scheduleId, { startsInMinutes = 60, lengthMinutes = 120 } = {}) {
  await query(
    `UPDATE event_schedules
     SET start_at = now() + make_interval(mins => $2),
         end_at = now() + make_interval(mins => $2 + $3),
         sales_start_at = now() + make_interval(mins => $2) - interval '10 days',
         sales_end_at = now() + make_interval(mins => $2)
     WHERE id = $1`,
    [scheduleId, startsInMinutes, lengthMinutes],
  );
}

/** New accounts put on the gate team of the event by its organizer; tokens carry the STAFF role. */
async function addStaff(eventId, count = 1) {
  const people = await createCustomers(count);
  const staff = [];
  for (const person of people) {
    const { rows } = await query(`SELECT email FROM users WHERE id = $1`, [person.id]);
    await request(app)
      .post(`/api/v1/events/${eventId}/staff`)
      .set(bearer(organizer.token))
      .send({ email: rows[0].email })
      .expect(201);
    const { accessToken } = signAccessToken({ id: person.id, roles: ['CUSTOMER', 'STAFF'] });
    staff.push({ ...person, email: rows[0].email, token: accessToken });
  }
  return staff;
}

/** Tickets on sale, the show starting within the hour, one staff member at the gate. */
async function atTheGate() {
  const world = await paidTickets();
  await moveShow(world.schedule.id);
  const [staff] = await addStaff(world.event.id);
  return { ...world, staff };
}

// ---------------------------------------------------------------------------
// TKT-01, TKT-02: my tickets, QR
// ---------------------------------------------------------------------------

describe('my tickets (TKT-01, TKT-02)', () => {
  test('a buyer sees their own tickets with the show, and the QR of each', async () => {
    const { buyer, tickets, event, schedule } = await paidTickets();
    const [stranger] = await createCustomers(1);

    expect(tickets.map((t) => t.seatLabel)).toEqual(['Khu A - A01', 'Khu A - A02', null, null, null]);
    expect(tickets.map((t) => t.admissionNo)).toEqual([1, 1, 1, 2, 3]);
    expect(tickets[0]).toMatchObject({
      status: 'VALID',
      ticketTypeName: 'CAT 1',
      event: { id: event.id, title: event.title },
      schedule: { id: schedule.id },
      venue: { name: expect.any(String) },
    });
    expect(tickets[0]).not.toHaveProperty('qrToken'); // only in the detail
    expect(await myTickets(stranger.token)).toEqual([]);
    expect(await myTickets(buyer.token, '?status=USED')).toEqual([]);

    const detail = await request(app).get(`/api/v1/tickets/${tickets[0].id}`).set(bearer(buyer.token)).expect(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    const token = detail.body.data.ticket.qrToken;
    expect(token).toBe(qrToken(tickets[0].id, 1));
    expect(token).not.toContain(buyer.id); // the ticket id only, never who owns it

    const png = await request(app).get(`/api/v1/tickets/${tickets[0].id}/qr.png`).set(bearer(buyer.token)).expect(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['cache-control']).toBe('no-store');
    expect(png.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  test("someone else's ticket is not found, for the detail and the image", async () => {
    const { tickets } = await paidTickets();
    const [stranger] = await createCustomers(1);
    const res = await request(app).get(`/api/v1/tickets/${tickets[0].id}`).set(bearer(stranger.token)).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    await request(app).get(`/api/v1/tickets/${tickets[0].id}/qr.png`).set(bearer(stranger.token)).expect(404);
    await request(app).get(`/api/v1/tickets/${tickets[0].id}`).expect(401);
  });

  test('a refunded ticket has no QR any more', async () => {
    const { buyer, payment, tickets } = await paidTickets();
    await request(app).post(`/api/v1/payments/${payment.id}/refund`).set(bearer(admin.token)).send({ reason: 'Ill' }).expect(200);

    const detail = await request(app).get(`/api/v1/tickets/${tickets[0].id}`).set(bearer(buyer.token)).expect(200);
    expect(detail.body.data.ticket).toMatchObject({ status: 'REFUNDED', qrToken: null });
    const png = await request(app).get(`/api/v1/tickets/${tickets[0].id}/qr.png`).set(bearer(buyer.token)).expect(409);
    expect(png.body.error.code).toBe('TICKET_NOT_VALID');
    expect(await myTickets(buyer.token, '?status=REFUNDED')).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Staff of an event
// ---------------------------------------------------------------------------

describe('event staff', () => {
  test('the organizer assigns staff by email: they get the STAFF role and see the event', async () => {
    const { event, schedule } = await paidTickets();
    const [staff] = await addStaff(event.id);

    const roles = await query(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.code`,
      [staff.id],
    );
    expect(roles.rows.map((r) => r.code)).toEqual(['CUSTOMER', 'STAFF']);
    const audit = await query(`SELECT action, new_value FROM audit_logs WHERE entity_id = $1 AND action = 'STAFF_ASSIGNED'`, [
      event.id,
    ]);
    expect(audit.rows).toEqual([{ action: 'STAFF_ASSIGNED', new_value: { userId: staff.id } }]);

    // Assigning the same person again changes nothing.
    await request(app).post(`/api/v1/events/${event.id}/staff`).set(bearer(organizer.token)).send({ email: staff.email }).expect(201);
    const list = await request(app).get(`/api/v1/events/${event.id}/staff`).set(bearer(organizer.token)).expect(200);
    expect(list.body.data.staff).toEqual([expect.objectContaining({ userId: staff.id, email: staff.email })]);

    const mine = await request(app).get('/api/v1/staff/events').set(bearer(staff.token)).expect(200);
    expect(mine.body.data.events).toEqual([
      expect.objectContaining({ id: event.id, schedules: [expect.objectContaining({ id: schedule.id })] }),
    ]);
  });

  test('an admin may check in anywhere, so the staff page lists every open event for them', async () => {
    const { event, schedule } = await paidTickets();
    const [staff] = await addStaff(event.id);
    const { event: other } = await paidTickets(); // nobody on its gate team

    const forAdmin = (await request(app).get('/api/v1/staff/events').set(bearer(admin.token)).expect(200)).body.data.events;
    expect(forAdmin).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: event.id, schedules: [expect.objectContaining({ id: schedule.id })] }),
        expect.objectContaining({ id: other.id }),
      ]),
    );
    // Staff still see only their own events.
    const forStaff = (await request(app).get('/api/v1/staff/events').set(bearer(staff.token)).expect(200)).body.data.events;
    expect(forStaff.map((e) => e.id)).toEqual([event.id]);
  });

  test('only the owner or an admin manages staff; the email must be an active account', async () => {
    const { event } = await paidTickets();
    const [person] = await createCustomers(1);
    const { rows } = await query(`SELECT email FROM users WHERE id = $1`, [person.id]);

    const foreign = await request(app)
      .post(`/api/v1/events/${event.id}/staff`)
      .set(bearer(otherOrganizer.token))
      .send({ email: rows[0].email });
    expect(foreign.status).toBe(404);
    await request(app).post(`/api/v1/events/${event.id}/staff`).set(bearer(person.token)).send({ email: rows[0].email }).expect(403);
    const unknown = await request(app)
      .post(`/api/v1/events/${event.id}/staff`)
      .set(bearer(organizer.token))
      .send({ email: 'nobody-here@example.com' })
      .expect(422);
    expect(unknown.body.error.code).toBe('STAFF_USER_NOT_FOUND');
    await request(app).post(`/api/v1/events/${event.id}/staff`).set(bearer(admin.token)).send({ email: rows[0].email }).expect(201);
  });

  test('removing a staff member takes them off this event only; they keep the role', async () => {
    const { event } = await paidTickets();
    const [staff] = await addStaff(event.id);

    await request(app).delete(`/api/v1/events/${event.id}/staff/${staff.id}`).set(bearer(organizer.token)).expect(204);
    await request(app).delete(`/api/v1/events/${event.id}/staff/${staff.id}`).set(bearer(organizer.token)).expect(404);
    const list = await request(app).get(`/api/v1/events/${event.id}/staff`).set(bearer(organizer.token)).expect(200);
    expect(list.body.data.staff).toEqual([]);
    const roles = await query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.code = 'STAFF'`, [
      staff.id,
    ]);
    expect(roles.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CHK-01: check-in
// ---------------------------------------------------------------------------

describe('check-in (CHK-01)', () => {
  test('a valid ticket gets in once; the second scan says when, where and by whom', async () => {
    const { buyer, staff, tickets, schedule } = await atTheGate();
    const qr = await qrOf(buyer.token, tickets[0].id);

    const res = await scan(staff.token, { qrToken: qr, scheduleId: schedule.id, deviceId: 'gate-A-01' }).expect(201);
    expect(res.body.data).toMatchObject({
      checkIn: { deviceId: 'gate-A-01' },
      ticket: { id: tickets[0].id, status: 'USED', ticketTypeName: 'CAT 1', seatLabel: 'Khu A - A01' },
      stats: { total: 5, checkedIn: 1 },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/buyer-|@example\.com/); // nothing about the buyer
    expect(await ticketStatus(tickets[0].id)).toBe('USED');

    const again = await scan(staff.token, { qrToken: qr, scheduleId: schedule.id, deviceId: 'gate-B-02' }).expect(409);
    expect(again.body.error).toMatchObject({
      code: 'TICKET_ALREADY_USED',
      details: { deviceId: 'gate-A-01', staffName: 'Test Buyer', checkedInAt: expect.any(String) },
    });
    expect(await checkInCount(tickets[0].id)).toBe(1);

    const mine = await myTickets(buyer.token, '?status=USED');
    expect(mine).toEqual([expect.objectContaining({ id: tickets[0].id, usedAt: expect.any(String) })]);
  });

  test('TEST-02: two gates scanning the same ticket at the same moment: exactly one gets in', async () => {
    const { buyer, tickets, schedule, event } = await atTheGate();
    const [gateA, gateB] = await addStaff(event.id, 2);
    const qr = await qrOf(buyer.token, tickets[2].id);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        scan(i % 2 === 0 ? gateA.token : gateB.token, { qrToken: qr, scheduleId: schedule.id, deviceId: `gate-${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const rejected = results.filter((r) => r.status !== 201);
    expect(rejected).toHaveLength(9);
    expect(rejected.every((r) => r.status === 409 && r.body.error.code === 'TICKET_ALREADY_USED')).toBe(true);
    expect(await checkInCount(tickets[2].id)).toBe(1);
  });

  test('an edited, forged, garbage or retired QR is rejected and nothing is written', async () => {
    const { buyer, staff, tickets, schedule } = await atTheGate();
    const qr = await qrOf(buyer.token, tickets[0].id);
    const lastChar = qr.at(-1) === 'a' ? 'b' : 'a';
    const forgedSignature = createHmac('sha256', 'not-the-secret').update(`${tickets[0].id}.1`).digest('hex');

    for (const bad of [qr.slice(0, -1) + lastChar, `${tickets[0].id}.1.${forgedSignature}`, 'hello', `${randomUUID()}.1.${'0'.repeat(64)}`]) {
      const res = await scan(staff.token, { qrToken: bad, scheduleId: schedule.id }).expect(422);
      expect(res.body.error.code).toBe('QR_INVALID');
    }

    // Re-issuing the QR (TKT-03, Phase 12) bumps the version: the old code stops working.
    await query(`UPDATE tickets SET qr_version = 2, qr_token_hash = $2 WHERE id = $1`, [
      tickets[0].id,
      qrTokenHash(qrToken(tickets[0].id, 2)),
    ]);
    expect((await scan(staff.token, { qrToken: qr, scheduleId: schedule.id }).expect(422)).body.error.code).toBe('QR_INVALID');
    expect(await checkInCount(tickets[0].id)).toBe(0);

    const current = await qrOf(buyer.token, tickets[0].id);
    expect(current).toBe(qrToken(tickets[0].id, 2));
    await scan(staff.token, { qrToken: current, scheduleId: schedule.id }).expect(201);
  });

  test('staff of another event cannot scan; an admin can scan anywhere', async () => {
    const { buyer, tickets, schedule } = await atTheGate();
    const elsewhere = await atTheGate(); // staff assigned to a different event
    const qr = await qrOf(buyer.token, tickets[0].id);

    const res = await scan(elsewhere.staff.token, { qrToken: qr, scheduleId: schedule.id }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await checkInCount(tickets[0].id)).toBe(0);

    await scan(buyer.token, { qrToken: qr, scheduleId: schedule.id }).expect(403); // a customer has no checkin:create
    await scan(admin.token, { qrToken: qr, scheduleId: schedule.id }).expect(201);
  });

  test('a ticket for another show is rejected with the right show', async () => {
    const { buyer, staff, tickets, schedule } = await atTheGate();
    const other = await paidTickets();
    const qr = await qrOf(buyer.token, tickets[0].id);

    const res = await scan(staff.token, { qrToken: qr, scheduleId: other.schedule.id }).expect(422);
    expect(res.body.error).toMatchObject({ code: 'WRONG_SCHEDULE', details: { schedule: { id: schedule.id } } });
    expect(await checkInCount(tickets[0].id)).toBe(0);
  });

  test('gates open 3 hours before the show and close when it ends', async () => {
    const { buyer, staff, tickets, schedule } = await atTheGate();
    const qr = await qrOf(buyer.token, tickets[0].id);

    await moveShow(schedule.id, { startsInMinutes: 200 });
    expect((await scan(staff.token, { qrToken: qr, scheduleId: schedule.id }).expect(422)).body.error.code).toBe('CHECKIN_NOT_OPEN');
    await moveShow(schedule.id, { startsInMinutes: -180, lengthMinutes: 120 });
    expect((await scan(staff.token, { qrToken: qr, scheduleId: schedule.id }).expect(422)).body.error.code).toBe('CHECKIN_CLOSED');
    expect(await checkInCount(tickets[0].id)).toBe(0);

    await moveShow(schedule.id, { startsInMinutes: 170 }); // within the 3 hours
    await scan(staff.token, { qrToken: qr, scheduleId: schedule.id }).expect(201);
  });

  test('a refunded ticket does not get in', async () => {
    const { buyer, staff, tickets, schedule, payment } = await atTheGate();
    const qr = await qrOf(buyer.token, tickets[0].id); // saved before the refund (a screenshot)
    await request(app).post(`/api/v1/payments/${payment.id}/refund`).set(bearer(admin.token)).send({ reason: 'Ill' }).expect(200);

    const res = await scan(staff.token, { qrToken: qr, scheduleId: schedule.id }).expect(409);
    expect(res.body.error).toMatchObject({ code: 'TICKET_NOT_VALID', details: { status: 'REFUNDED' } });
    expect(await checkInCount(tickets[0].id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CHK-02, CHK-03: history, stats, live updates
// ---------------------------------------------------------------------------

describe('check-in history and stats (CHK-02, CHK-03)', () => {
  test('stats per ticket type and the history, for staff, the organizer and admins only', async () => {
    const { buyer, staff, tickets, schedule } = await atTheGate();
    await scan(staff.token, { qrToken: await qrOf(buyer.token, tickets[0].id), scheduleId: schedule.id, deviceId: 'A' }).expect(201);
    await scan(staff.token, { qrToken: await qrOf(buyer.token, tickets[3].id), scheduleId: schedule.id, deviceId: 'B' }).expect(201);

    for (const token of [staff.token, organizer.token, admin.token]) {
      const res = await request(app).get(`/api/v1/schedules/${schedule.id}/check-in-stats`).set(bearer(token)).expect(200);
      expect(res.body.data.stats).toEqual({
        scheduleId: schedule.id,
        total: 5,
        checkedIn: 2,
        byTicketType: [
          { ticketTypeId: expect.any(String), ticketTypeName: 'CAT 1', total: 2, checkedIn: 1 },
          { ticketTypeId: expect.any(String), ticketTypeName: 'Standing', total: 3, checkedIn: 1 },
        ],
      });
    }

    const history = await request(app).get(`/api/v1/schedules/${schedule.id}/check-ins?pageSize=1`).set(bearer(organizer.token)).expect(200);
    expect(history.body.meta).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(history.body.data.checkIns).toEqual([
      expect.objectContaining({ deviceId: 'B', staffName: 'Test Buyer', ticket: expect.objectContaining({ id: tickets[3].id, admissionNo: 2 }) }),
    ]);

    const foreign = await request(app).get(`/api/v1/schedules/${schedule.id}/check-in-stats`).set(bearer(otherOrganizer.token));
    expect(foreign.status).toBe(404);
    await request(app).get(`/api/v1/schedules/${schedule.id}/check-ins`).set(bearer(buyer.token)).expect(403);
  });

  test('staff and the organizer hear CHECK_IN_SUCCESS; the buyer does not', async () => {
    const server = await startServer();
    try {
      const { buyer, staff, tickets, schedule } = await atTheGate();
      const sockets = {};
      for (const [name, token] of [['gate', staff.token], ['boss', organizer.token], ['buyer', buyer.token]]) {
        sockets[name] = await connect(server.url);
        sockets[name].send({ type: 'AUTH', token });
        await sockets[name].waitFor('AUTH_OK');
      }

      await scan(staff.token, { qrToken: await qrOf(buyer.token, tickets[0].id), scheduleId: schedule.id }).expect(201);
      const ofThisShow = (m) => m.type === 'CHECK_IN_SUCCESS' && m.scheduleId === schedule.id;
      for (const name of ['gate', 'boss']) {
        expect(await sockets[name].waitFor(ofThisShow)).toMatchObject({ checkedIn: 1, total: 5, ticketTypeName: 'CAT 1' });
      }
      await sockets.buyer.expectNone('CHECK_IN_SUCCESS');
      Object.values(sockets).forEach((socket) => socket.close());
    } finally {
      await server.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Refunds after check-in
// ---------------------------------------------------------------------------

describe('refunds after check-in', () => {
  test('an order with a checked-in ticket is not refundable; cancelling the event still refunds it', async () => {
    const { buyer, staff, tickets, schedule, payment, order, event } = await atTheGate();
    await scan(staff.token, { qrToken: await qrOf(buyer.token, tickets[0].id), scheduleId: schedule.id }).expect(201);

    const res = await request(app).post(`/api/v1/payments/${payment.id}/refund`).set(bearer(admin.token)).send({ reason: 'Asked' }).expect(409);
    expect(res.body.error.code).toBe('PAYMENT_NOT_REFUNDABLE');
    expect(await orderStatus(order.id)).toBe('PAID');

    await changeStatus(app, organizer.token, event.id, 'CANCELLED', 'Storm warning').expect(200);
    expect(await orderStatus(order.id)).toBe('REFUNDED');
    expect(await ticketStatus(tickets[0].id)).toBe('USED'); // history stays true
    expect(await ticketStatus(tickets[1].id)).toBe('REFUNDED');
  });
});

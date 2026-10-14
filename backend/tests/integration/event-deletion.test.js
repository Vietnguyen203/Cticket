const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book } = require('../helpers/orders');
const { findInventoryMismatches } = require('../../src/modules/orders');

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

const summary = (token, eventId) => request(app).get(`/api/v1/events/${eventId}/deletion-summary`).set(bearer(token));
const remove = (token, eventId, body) => request(app).delete(`/api/v1/events/${eventId}`).set(bearer(token)).send(body);
const count = async (sql, params) => (await query(sql, params)).rows[0].n;

/** PUBLISHED; one buyer paid A01 + 3 standing with a 10 % code (5 tickets); one ticket scanned; a second buyer only holds A02. */
async function soldEvent() {
  const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  const seat = Object.fromEntries(world.seats.map((s) => [s.code, s.id]));
  const code = `DEL${randomUUID().slice(0, 8)}`;
  await request(app)
    .post('/api/v1/promotions')
    .set(bearer(admin.token))
    .send({
      code,
      name: 'Delete test',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .expect(201);

  const [buyer, holder] = await createCustomers(2);
  const { order } = (
    await book(app, buyer.token, world.schedule.id, { seatIds: [seat.A01], items: [{ ticketTypeId: world.standing.id, quantity: 3 }] }).expect(201)
  ).body.data;
  await request(app).post(`/api/v1/orders/${order.id}/checkout`).set(bearer(buyer.token)).send({ promotionCode: code }).expect(200);
  await request(app).post('/api/v1/payments').set(bearer(buyer.token)).set('Idempotency-Key', randomUUID()).send({ orderId: order.id }).expect(201);
  await book(app, holder.token, world.schedule.id, { seatIds: [seat.A02] }).expect(201);
  await query(
    `WITH t AS (UPDATE tickets SET status = 'USED', used_at = now()
                WHERE id = (SELECT id FROM tickets WHERE order_id = $1 LIMIT 1) RETURNING id, event_id, schedule_id, user_id)
     INSERT INTO check_ins (ticket_id, event_id, schedule_id, staff_user_id) SELECT id, event_id, schedule_id, user_id FROM t`,
    [order.id],
  );
  return { ...world, code, buyer };
}

describe('deleting an event with its sales', () => {
  test('the organizer sees what would go, confirms with the title, and everything goes', async () => {
    const { event, schedule, code, buyer } = await soldEvent();

    const preview = (await summary(organizer.token, event.id).expect(200)).body.data.summary;
    expect(preview).toEqual({
      title: event.title,
      status: 'PUBLISHED',
      schedules: 1,
      orders: 2,
      paidOrders: 1,
      revenue: 3_150_000, // (2.000.000 + 3 × 500.000) − 10 %
      tickets: 4,
      checkIns: 1,
    });

    // Not without the exact title.
    const unconfirmed = await remove(organizer.token, event.id).expect(422);
    expect(unconfirmed.body.error).toMatchObject({ code: 'DELETE_CONFIRMATION_REQUIRED', details: expect.objectContaining({ orders: 2 }) });
    await remove(organizer.token, event.id, { confirmTitle: 'not the title' }).expect(422);

    await remove(organizer.token, event.id, { confirmTitle: ` ${event.title} ` }).expect(204);

    expect(await count(`SELECT count(*)::int AS n FROM events WHERE id = $1`, [event.id])).toBe(0);
    for (const table of ['orders', 'tickets', 'check_ins', 'order_items', 'schedule_seats', 'ga_inventory', 'ticket_types']) {
      expect(await count(`SELECT count(*)::int AS n FROM ${table} WHERE schedule_id = $1`, [schedule.id])).toBe(0);
    }
    expect(await count(`SELECT count(*)::int AS n FROM event_schedules WHERE id = $1`, [schedule.id])).toBe(0);
    // The code's use came back.
    expect(await count(`SELECT used_count AS n FROM promotions WHERE code = upper($1)`, [code])).toBe(0);
    // The buyer's tickets are gone with it.
    const tickets = (await request(app).get('/api/v1/tickets').set(bearer(buyer.token)).expect(200)).body.data.tickets;
    expect(tickets).toEqual([]);

    const { rows } = await query(`SELECT action, old_value, new_value FROM audit_logs WHERE entity_id = $1 AND action = 'EVENT_DELETED'`, [event.id]);
    expect(rows).toEqual([
      {
        action: 'EVENT_DELETED',
        old_value: expect.objectContaining({ title: event.title, status: 'PUBLISHED' }),
        new_value: expect.objectContaining({ orders: 2, paidOrders: 1, revenue: 3_150_000, tickets: 4, checkIns: 1 }),
      },
    ]);
  });

  test("another organizer can neither see nor delete it; an admin can delete anyone's event", async () => {
    const { event } = await soldEvent();
    await summary(otherOrganizer.token, event.id).expect(404);
    await remove(otherOrganizer.token, event.id, { confirmTitle: event.title }).expect(404);
    const [customer] = await createCustomers(1);
    await remove(customer.token, event.id, { confirmTitle: event.title }).expect(403);

    await summary(admin.token, event.id).expect(200);
    await remove(admin.token, event.id, { confirmTitle: event.title }).expect(204);
    await request(app).get(`/api/v1/events/${event.id}`).set(bearer(admin.token)).expect(404);
  });
});

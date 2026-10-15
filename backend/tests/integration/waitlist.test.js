const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, cancelOrder } = require('../helpers/orders');
const { findInventoryMismatches } = require('../../src/modules/orders');
const waitlist = require('../../src/modules/waitlist');

/** Phase 18.4: waiting for a sold-out ticket type. */
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

/** A published event whose standing tickets have only 2 places left (98 of 100 blocked by the organizer). */
async function twoStandingLeft() {
  const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  await request(app)
    .post(`/api/v1/schedules/${world.schedule.id}/inventory/block`)
    .set(bearer(organizer.token))
    .send({ action: 'BLOCK', reason: 'Kept for sponsors', ticketTypeId: world.standing.id, quantity: 98 })
    .expect(200);
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

const join = (token, scheduleId, ticketTypeId, quantity = 1) =>
  request(app).post(`/api/v1/schedules/${scheduleId}/waitlist`).set(bearer(token)).send({ ticketTypeId, quantity });
const standing = (world, quantity) => ({ items: [{ ticketTypeId: world.standing.id, quantity }] });
const availabilityOf = async (token, world, ticketTypeId) => {
  const res = await request(app).get(`/api/v1/schedules/${world.schedule.id}/availability`).set(bearer(token)).expect(200);
  return res.body.data.ticketTypes.find((tt) => tt.id === ticketTypeId);
};
const entriesOf = async (ticketTypeId) =>
  (
    await query(`SELECT user_id, status, quantity FROM waitlist_entries WHERE ticket_type_id = $1 ORDER BY created_at`, [ticketTypeId])
  ).rows;
const emailOf = async (userId) => (await query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0].email;

describe('joining', () => {
  test('only when there is not enough left; once per ticket type; within the per-order limit', async () => {
    const world = await twoStandingLeft();
    const [a, b] = await createCustomers(2);
    expect((await join(b.token, world.schedule.id, world.standing.id).expect(409)).body.error.code).toBe('WAITLIST_NOT_NEEDED');
    expect((await join(b.token, world.schedule.id, world.standing.id, 3).expect(201)).body.data.entry).toMatchObject({
      status: 'WAITING',
      quantity: 3,
      position: 1,
    });

    await book(app, a.token, world.schedule.id, standing(world, 2)).expect(201); // sold out
    const [c] = await createCustomers(1);
    const joined = await join(c.token, world.schedule.id, world.standing.id).expect(201);
    expect(joined.body.data.entry).toMatchObject({ position: 2, ticketType: { name: 'Standing' }, event: { slug: world.event.slug } });
    expect((await join(c.token, world.schedule.id, world.standing.id).expect(409)).body.error.code).toBe('WAITLIST_ALREADY_JOINED');
    expect((await join(c.token, world.schedule.id, world.cat1.id, 9).expect(400)).body.error.code).toBe('VALIDATION_ERROR');

    const mine = await request(app).get('/api/v1/waitlist').set(bearer(c.token)).expect(200);
    expect(mine.body.data.entries).toEqual([expect.objectContaining({ id: joined.body.data.entry.id, status: 'WAITING' })]);
    await request(app).delete(`/api/v1/waitlist/${joined.body.data.entry.id}`).set(bearer(c.token)).expect(200);
    await request(app).delete(`/api/v1/waitlist/${joined.body.data.entry.id}`).set(bearer(c.token)).expect(404);
  });
});

describe('offers', () => {
  test('freed places go to the earliest people that fit, are kept 30 minutes, and booking ends the entry', async () => {
    const world = await twoStandingLeft();
    const [a, b, c, d, outsider] = await createCustomers(5);
    const held = (await book(app, a.token, world.schedule.id, standing(world, 2)).expect(201)).body.data.order;
    await join(b.token, world.schedule.id, world.standing.id, 1).expect(201);
    await join(c.token, world.schedule.id, world.standing.id, 2).expect(201);
    await join(d.token, world.schedule.id, world.standing.id, 1).expect(201);

    await waitlist.offerSpacesToWaitlist();
    expect((await entriesOf(world.standing.id)).map((e) => e.status)).toEqual(['WAITING', 'WAITING', 'WAITING']); // nothing free yet

    await cancelOrder(app, a.token, held.id).expect(200); // 2 places free
    await Promise.all([waitlist.offerSpacesToWaitlist(), waitlist.offerSpacesToWaitlist()]); // two workers: no double offer
    // b (1) fits, c (2) does not fit what is left, d (1) does.
    expect((await entriesOf(world.standing.id)).map((e) => e.status)).toEqual(['OFFERED', 'WAITING', 'OFFERED']);
    expect(mailbox.subjects(await emailOf(b.id))).toEqual([`Đã có vé: ${world.event.title}`]);
    expect(mailbox.latestText(await emailOf(d.id))).toContain('được giữ riêng cho bạn tới');
    const { rows } = await query(`SELECT type FROM notifications WHERE user_id = $1`, [b.id]);
    expect(rows.map((r) => r.type)).toContain('WAITLIST_OFFER');

    // Someone else cannot take the kept places; the map says why.
    expect(await availabilityOf(outsider.token, world, world.standing.id)).toMatchObject({ available: 0, waitlistKept: 2 });
    const refused = await book(app, outsider.token, world.schedule.id, standing(world, 1)).expect(409);
    expect(refused.body.error.code).toBe('WAITLIST_RESERVED');

    // The people offered can: their own place is not "kept from" them.
    expect(await availabilityOf(b.token, world, world.standing.id)).toMatchObject({ available: 1, waitlistKept: 1 });
    await book(app, b.token, world.schedule.id, standing(world, 1)).expect(201);
    expect((await entriesOf(world.standing.id)).map((e) => e.status)).toEqual(['BOOKED', 'WAITING', 'OFFERED']);

    // d lets the offer run out: the place goes back to the list (c still needs 2, so nobody fits yet).
    await query(`UPDATE waitlist_entries SET offer_expires_at = now() - interval '1 second' WHERE user_id = $1`, [d.id]);
    await waitlist.offerSpacesToWaitlist();
    expect((await entriesOf(world.standing.id)).map((e) => e.status)).toEqual(['BOOKED', 'WAITING', 'EXPIRED']);
    await book(app, outsider.token, world.schedule.id, standing(world, 1)).expect(201); // nobody keeps it any more
  });

  test('seats: a kept seat of the type cannot be held by someone else', async () => {
    const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
    await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
    const seat = Object.fromEntries(world.seats.map((s) => [s.code, s.id]));
    const others = Object.entries(seat).filter(([code]) => code.startsWith('A') && code !== 'A01').map(([, id]) => id);
    await request(app)
      .post(`/api/v1/schedules/${world.schedule.id}/inventory/block`)
      .set(bearer(organizer.token))
      .send({ action: 'BLOCK', reason: 'Camera platform', seatIds: others })
      .expect(200);

    const [a, b, outsider] = await createCustomers(3);
    const held = (await book(app, a.token, world.schedule.id, { seatIds: [seat.A01] }).expect(201)).body.data.order;
    await join(b.token, world.schedule.id, world.cat1.id).expect(201);
    await cancelOrder(app, a.token, held.id).expect(200);
    await waitlist.offerSpacesToWaitlist();

    expect((await book(app, outsider.token, world.schedule.id, { seatIds: [seat.A01] }).expect(409)).body.error.code).toBe('WAITLIST_RESERVED');
    await book(app, b.token, world.schedule.id, { seatIds: [seat.A01] }).expect(201);
    expect((await entriesOf(world.cat1.id)).map((e) => e.status)).toEqual(['BOOKED']);
  });

  test('a show that stops selling closes its list', async () => {
    const world = await twoStandingLeft();
    const [a, b] = await createCustomers(2);
    await book(app, a.token, world.schedule.id, standing(world, 2)).expect(201);
    await join(b.token, world.schedule.id, world.standing.id).expect(201);
    await query(
      `UPDATE event_schedules SET sales_end_at = now() - interval '1 minute', sales_start_at = least(sales_start_at, now() - interval '1 day')
       WHERE id = $1`,
      [world.schedule.id],
    );
    await waitlist.offerSpacesToWaitlist();
    expect((await entriesOf(world.standing.id)).map((e) => e.status)).toEqual(['CLOSED']);
  });
});

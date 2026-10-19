const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { redis } = require('../../src/redis/client');
const { QUEUE } = require('../../src/queue/queues');
const processors = require('../../src/queue/processors');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, cancelOrder, makeDue } = require('../helpers/orders');

/** Phase 21: the purchase queue ("waiting room") of an event. */
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

/** A published event; with `queue`, its purchase queue switched on with those settings. */
async function onSale(queue) {
  const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  if (queue) await setQueue(world.event.id, { queueEnabled: true, ...queue }).expect(200);
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

const setQueue = (eventId, body, token = organizer.token) =>
  request(app).patch(`/api/v1/events/${eventId}`).set(bearer(token)).send(body);
const join = (token, eventId) => request(app).post(`/api/v1/events/${eventId}/queue`).set(bearer(token));
const status = (token, eventId) => request(app).get(`/api/v1/events/${eventId}/queue`).set(bearer(token));
const leave = (token, eventId) => request(app).delete(`/api/v1/events/${eventId}/queue`).set(bearer(token));
const queueOf = (res) => res.body.data.queue;
const stateOf = async (token, eventId) => queueOf(await status(token, eventId).expect(200));
const pay = async (token, orderId) => {
  await request(app).post(`/api/v1/orders/${orderId}/checkout`).set(bearer(token)).send({}).expect(200);
  await request(app).post('/api/v1/payments').set(bearer(token)).set('Idempotency-Key', randomUUID()).send({ orderId }).expect(201);
};
const runJob = (name) => processors.run(QUEUE.MAINTENANCE, { name, data: {} });
/** The turn of `userId` ran out (instead of waiting 10 minutes). */
const endTurn = (eventId, userId) => redis.zadd(`queue:${eventId}:active`, 'XX', Date.now() - 1000, userId);

describe('settings', () => {
  test('off by default: no queue, everyone books as before', async () => {
    const { event, schedule, seat } = await onSale();
    const [buyer] = await createCustomers(1);
    const res = await join(buyer.token, event.id).expect(200);
    expect(queueOf(res)).toMatchObject({ enabled: false, state: 'ACTIVE' });
    await book(app, buyer.token, schedule.id, { seatIds: [seat.A01] }).expect(201);
  });

  test('the organizer switches it on after publishing (audited); the event page shows it; limits checked', async () => {
    const { event } = await onSale();
    await setQueue(event.id, { queueEnabled: true, queueCapacity: 0 }).expect(400);
    await setQueue(event.id, { queueSessionMinutes: 60 }).expect(400);
    const res = await setQueue(event.id, { queueEnabled: true, queueCapacity: 50, queueSessionMinutes: 15 }).expect(200);
    expect(res.body.data.event.queue).toEqual({ enabled: true, capacity: 50, sessionMinutes: 15 });
    const page = await request(app).get(`/api/v1/events/${event.id}`).expect(200);
    expect(page.body.data.event.queue).toEqual({ enabled: true, capacity: 50, sessionMinutes: 15 });

    const { rows } = await query(
      `SELECT old_value, new_value FROM audit_logs WHERE entity_id = $1 AND action = 'EVENT_QUEUE_UPDATED'`,
      [event.id],
    );
    expect(rows).toEqual([
      { old_value: { enabled: false, capacity: 100, sessionMinutes: 10 }, new_value: { enabled: true, capacity: 50, sessionMinutes: 15 } },
    ]);
  });

  test('numbers for the organizer and admins only', async () => {
    const { event } = await onSale({ queueCapacity: 1 });
    const [a, b, c] = await createCustomers(3);
    for (const buyer of [a, b, c]) await join(buyer.token, event.id).expect(200);

    const stats = await request(app).get(`/api/v1/events/${event.id}/queue/stats`).set(bearer(organizer.token)).expect(200);
    expect(stats.body.data.queue).toEqual({ enabled: true, capacity: 1, sessionMinutes: 10, active: 1, waiting: 2 });
    await request(app).get(`/api/v1/events/${event.id}/queue/stats`).set(bearer(admin.token)).expect(200);
    await request(app).get(`/api/v1/events/${event.id}/queue/stats`).set(bearer(a.token)).expect(403);
    const other = await createOrganizer(app, mailbox, admin.token);
    await request(app).get(`/api/v1/events/${event.id}/queue/stats`).set(bearer(other.token)).expect(404);
  });
});

describe('one at a time (capacity 1)', () => {
  test('A buys, B waits (and cannot book), C behind B; A pays → B is let in and told', async () => {
    const { event, schedule, seat } = await onSale({ queueCapacity: 1 });
    const [a, b, c] = await createCustomers(3);

    expect(queueOf(await join(a.token, event.id).expect(200))).toMatchObject({ enabled: true, state: 'ACTIVE', place: null });
    expect(queueOf(await join(b.token, event.id).expect(200))).toMatchObject({ state: 'WAITING', place: 1, ahead: 0, estimatedWaitSeconds: 300 });
    expect(queueOf(await join(c.token, event.id).expect(200))).toMatchObject({ state: 'WAITING', place: 2, ahead: 1 });

    const refused = await book(app, b.token, schedule.id, { seatIds: [seat.B01] }).expect(409);
    expect(refused.body.error.code).toBe('QUEUE_TURN_REQUIRED');
    const never = await book(app, (await createCustomers(1))[0].token, schedule.id, { seatIds: [seat.B01] }).expect(409);
    expect(never.body.error.code).toBe('QUEUE_TURN_REQUIRED');

    const { order } = (await book(app, a.token, schedule.id, { seatIds: [seat.A01] }).expect(201)).body.data;
    // The turn now lasts as long as the hold.
    const turnEnds = Number(await redis.zscore(`queue:${event.id}:active`, a.id));
    expect(Math.abs(turnEnds - new Date(order.expiresAt).getTime())).toBeLessThan(1000);

    const published = jest.spyOn(redis, 'publish');
    try {
      await pay(a.token, order.id);
      const told = published.mock.calls.map(([, payload]) => JSON.parse(payload)).filter(({ message }) => message.type === 'QUEUE_ADMITTED');
      expect(told).toEqual([{ room: `user:${b.id}`, message: { type: 'QUEUE_ADMITTED', eventId: event.id, turnEndsAt: expect.any(String) } }]);
    } finally {
      published.mockRestore();
    }
    expect(await stateOf(a.token, event.id)).toMatchObject({ state: 'NONE' });
    expect(await stateOf(b.token, event.id)).toMatchObject({ state: 'ACTIVE' });
    expect(await stateOf(c.token, event.id)).toMatchObject({ state: 'WAITING', place: 1 });
    await book(app, b.token, schedule.id, { seatIds: [seat.B01] }).expect(201);
  });

  test('a cancelled or expired order ends the turn too', async () => {
    const { event, schedule, seat } = await onSale({ queueCapacity: 1 });
    const [a, b, c] = await createCustomers(3);
    for (const buyer of [a, b, c]) await join(buyer.token, event.id).expect(200);

    const first = (await book(app, a.token, schedule.id, { seatIds: [seat.A01] }).expect(201)).body.data.order;
    await cancelOrder(app, a.token, first.id).expect(200);
    expect(await stateOf(b.token, event.id)).toMatchObject({ state: 'ACTIVE' });

    const second = (await book(app, b.token, schedule.id, { seatIds: [seat.A02] }).expect(201)).body.data.order;
    await makeDue(second.id);
    await runJob('sweep-holds');
    expect(await stateOf(b.token, event.id)).toMatchObject({ state: 'NONE' });
    expect(await stateOf(c.token, event.id)).toMatchObject({ state: 'ACTIVE' });
  });

  test('a turn that ran out without an order: the admission job lets the next one in', async () => {
    const { event } = await onSale({ queueCapacity: 1 });
    const [a, b] = await createCustomers(2);
    await join(a.token, event.id).expect(200);
    await join(b.token, event.id).expect(200);

    await endTurn(event.id, a.id);
    expect(await runJob('admit-queues')).toBeGreaterThanOrEqual(1);
    expect(Number(await redis.zscore(`queue:${event.id}:active`, b.id))).toBeGreaterThan(Date.now());
    expect(await stateOf(a.token, event.id)).toMatchObject({ state: 'NONE' });
  });

  test('a newcomer never goes in ahead of someone waiting, even when a turn just ended', async () => {
    const { event } = await onSale({ queueCapacity: 1 });
    const [a, b, c] = await createCustomers(3);
    await join(a.token, event.id).expect(200);
    await join(b.token, event.id).expect(200);
    await endTurn(event.id, a.id);

    expect(queueOf(await join(c.token, event.id).expect(200))).toMatchObject({ state: 'WAITING', place: 1 });
    expect(await stateOf(b.token, event.id)).toMatchObject({ state: 'ACTIVE' });
  });

  test('joining again keeps the place; leaving gives it to the next one', async () => {
    const { event } = await onSale({ queueCapacity: 1 });
    const [a, b, c] = await createCustomers(3);
    for (const buyer of [a, b, c]) await join(buyer.token, event.id).expect(200);

    expect(queueOf(await join(b.token, event.id).expect(200))).toMatchObject({ state: 'WAITING', place: 1 });
    await leave(b.token, event.id).expect(200);
    expect(await stateOf(c.token, event.id)).toMatchObject({ state: 'WAITING', place: 1 });
    await leave(a.token, event.id).expect(200);
    expect(await stateOf(c.token, event.id)).toMatchObject({ state: 'ACTIVE' });
  });

  test('places offered from the waiting list are booked without a turn', async () => {
    const { event, schedule, standing } = await onSale({ queueCapacity: 1 });
    const [a, invited] = await createCustomers(2);
    await join(a.token, event.id).expect(200);
    await query(
      `INSERT INTO waitlist_entries (user_id, schedule_id, ticket_type_id, quantity, status, offered_at, offer_expires_at)
       VALUES ($1, $2, $3, 1, 'OFFERED', now(), now() + interval '30 minutes')`,
      [invited.id, schedule.id, standing.id],
    );
    await book(app, invited.token, schedule.id, { items: [{ ticketTypeId: standing.id, quantity: 1 }] }).expect(201);
  });

  test('switching the queue off drops it: everyone may book', async () => {
    const { event, schedule, seat } = await onSale({ queueCapacity: 1 });
    const [a, b] = await createCustomers(2);
    await join(a.token, event.id).expect(200);
    await join(b.token, event.id).expect(200);

    await setQueue(event.id, { queueEnabled: false }).expect(200);
    expect(await redis.exists(`queue:${event.id}:active`, `queue:${event.id}:waiting`)).toBe(0);
    expect(await stateOf(b.token, event.id)).toMatchObject({ enabled: false, state: 'ACTIVE' });
    await book(app, b.token, schedule.id, { seatIds: [seat.B01] }).expect(201);
  });

  test('more room: the people waiting are let in at once', async () => {
    const { event } = await onSale({ queueCapacity: 1 });
    const [a, b, c] = await createCustomers(3);
    for (const buyer of [a, b, c]) await join(buyer.token, event.id).expect(200);
    await setQueue(event.id, { queueCapacity: 3 }).expect(200);
    expect(await stateOf(c.token, event.id)).toMatchObject({ state: 'ACTIVE' });
  });
});

describe('the rush', () => {
  test('200 people join at once with room for 10: exactly 10 in, places 1..190 each given once', async () => {
    const { event } = await onSale({ queueCapacity: 10 });
    const buyers = await createCustomers(200);
    const results = await Promise.all(buyers.map((buyer) => join(buyer.token, event.id).expect(200)));
    const views = results.map(queueOf);

    expect(views.filter((view) => view.state === 'ACTIVE')).toHaveLength(10);
    const places = views.filter((view) => view.state === 'WAITING').map((view) => view.place).sort((x, y) => x - y);
    expect(places).toEqual(Array.from({ length: 190 }, (_, i) => i + 1));
    expect(await redis.zcard(`queue:${event.id}:active`)).toBe(10);
  });
});

describe('Redis down', () => {
  test('the queue lets everyone through (PostgreSQL still decides every seat)', async () => {
    const { event, schedule, seat } = await onSale({ queueCapacity: 1 });
    const [a, b] = await createCustomers(2);
    await join(a.token, event.id).expect(200);

    const joinFails = jest.spyOn(redis, 'queueJoin').mockRejectedValue(new Error('Connection is closed.'));
    const turnFails = jest.spyOn(redis, 'queueHasTurn').mockRejectedValue(new Error('Connection is closed.'));
    try {
      expect(queueOf(await join(b.token, event.id).expect(200))).toMatchObject({ enabled: false, state: 'ACTIVE' });
      await book(app, b.token, schedule.id, { seatIds: [seat.B01] }).expect(201);
    } finally {
      joinFails.mockRestore();
      turnFails.mockRestore();
    }
  });
});

const request = require('supertest');
const { createApp } = require('../../src/app');
const { pool, closePool } = require('../../src/database/pool');
const { redis } = require('../../src/redis/client');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, cancelOrder } = require('../helpers/orders');
const { lockSeats } = require('../../src/modules/orders/fast-path');
const { findInventoryMismatches } = require('../../src/modules/orders');

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

async function onSale() {
  const world = await createConfiguredEvent(app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
  });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

const seatLockKey = (scheduleId, seatId) => `seatlock:${scheduleId}:${seatId}`;

async function hundredBuyersForOneSeat() {
  const { schedule, seat } = await onSale();
  const buyers = await createCustomers(100);
  const results = await Promise.all(buyers.map((b) => book(app, b.token, schedule.id, { seatIds: [seat.A01] })));
  return {
    won: results.filter((r) => r.status === 201).length,
    refused: results.filter((r) => r.status !== 201),
  };
}

describe('TEST-02: 100 buyers, one seat', () => {
  test('with Redis: exactly one order; most losers are stopped by the Redis lock', async () => {
    const { won, refused } = await hundredBuyersForOneSeat();
    expect(won).toBe(1);
    expect(refused).toHaveLength(99);
    expect(refused.every((r) => r.status === 409 && r.body.error.code === 'SEATS_UNAVAILABLE')).toBe(true);
    const lockedInRedis = refused.filter((r) => r.body.error.details[0].status === 'LOCKED').length;
    expect(lockedInRedis).toBeGreaterThan(0); // these never reached PostgreSQL
  });

  test('with Redis down: still exactly one order (PostgreSQL decides alone)', async () => {
    const spy = jest.spyOn(redis, 'seatLock').mockRejectedValue(new Error('Connection is closed.'));
    try {
      const { won, refused } = await hundredBuyersForOneSeat();
      expect(won).toBe(1);
      expect(refused.every((r) => r.body.error.code === 'SEATS_UNAVAILABLE')).toBe(true);
      expect(refused.some((r) => r.body.error.details[0].status === 'LOCKED')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('seat locks', () => {
  test('a seat locked by another request is refused fast; the foreign lock is left alone', async () => {
    const { schedule, seat } = await onSale();
    const [buyer] = await createCustomers(1);
    await redis.set(seatLockKey(schedule.id, seat.A01), 'another-request', 'PX', 5000);

    const refused = await book(app, buyer.token, schedule.id, { seatIds: [seat.A02, seat.A01] });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual([{ seatId: seat.A01, status: 'LOCKED' }]);
    // All or nothing: A02 was not locked either, and A01 still belongs to the other request.
    expect(await redis.get(seatLockKey(schedule.id, seat.A02))).toBeNull();
    expect(await redis.get(seatLockKey(schedule.id, seat.A01))).toBe('another-request');

    await redis.del(seatLockKey(schedule.id, seat.A01)); // the other request finished
    await book(app, buyer.token, schedule.id, { seatIds: [seat.A02, seat.A01] }).expect(201);
    expect(await redis.get(seatLockKey(schedule.id, seat.A01))).toBeNull(); // released after the booking
  });

  test('a lock that expired and was taken over is not deleted by its old owner', async () => {
    const { schedule, seat } = await onSale();
    const release = await lockSeats(schedule.id, [seat.B01]);
    await redis.set(seatLockKey(schedule.id, seat.B01), 'new-owner', 'PX', 5000); // as if ours had expired

    await release();
    expect(await redis.get(seatLockKey(schedule.id, seat.B01))).toBe('new-owner');
    await redis.del(seatLockKey(schedule.id, seat.B01));
  });
});

describe('general admission "sold out" hint', () => {
  test('after PostgreSQL says "sold out", the next requests are refused from Redis for a few seconds', async () => {
    const { schedule, standing } = await onSale();
    await request(app)
      .post(`/api/v1/schedules/${schedule.id}/inventory/block`)
      .set(bearer(organizer.token))
      .send({ action: 'BLOCK', reason: 'Sponsors', ticketTypeId: standing.id, quantity: 99 })
      .expect(200);
    const [first, second, third] = await createCustomers(3);
    const oneTicket = { items: [{ ticketTypeId: standing.id, quantity: 1 }] };

    const { order } = (await book(app, first.token, schedule.id, oneTicket).expect(201)).body.data;
    expect((await book(app, second.token, schedule.id, oneTicket)).body.error.code).toBe('INSUFFICIENT_INVENTORY');
    expect(await redis.get(`ga-left:${standing.id}`)).toBe('0');
    expect(await redis.pttl(`ga-left:${standing.id}`)).toBeLessThanOrEqual(3000);

    // A ticket comes back, but the hint may still refuse for up to 3 seconds...
    await cancelOrder(app, first.token, order.id).expect(200);
    expect((await book(app, third.token, schedule.id, oneTicket)).body.error.code).toBe('INSUFFICIENT_INVENTORY');
    // ...and once it expires, PostgreSQL decides again.
    await redis.del(`ga-left:${standing.id}`);
    await book(app, third.token, schedule.id, oneTicket).expect(201);
  });
});

describe('"seat taken" hint (Phase 13 load test)', () => {
  const hintKey = (scheduleId, seatId) => `seat-taken:${scheduleId}:${seatId}`;

  test('after PostgreSQL refused a seat, the next requests for it are refused from Redis, without a transaction', async () => {
    const { schedule, seat } = await onSale();
    const [holder, second, third] = await createCustomers(3);
    await book(app, holder.token, schedule.id, { seatIds: [seat.A05] }).expect(201);

    const refused = await book(app, second.token, schedule.id, { seatIds: [seat.A05] });
    expect(refused.body.error).toMatchObject({ code: 'SEATS_UNAVAILABLE', details: [{ seatId: seat.A05, status: 'HELD' }] });
    expect(await redis.get(hintKey(schedule.id, seat.A05))).toBe('HELD');
    expect(await redis.pttl(hintKey(schedule.id, seat.A05))).toBeLessThanOrEqual(3000);

    const connect = jest.spyOn(pool, 'connect');
    try {
      const fast = await book(app, third.token, schedule.id, { seatIds: [seat.A06, seat.A05] });
      expect(fast.status).toBe(409);
      expect(fast.body.error.details).toEqual([{ seatId: seat.A05, status: 'HELD' }]);
      expect(connect).not.toHaveBeenCalled(); // no transaction was opened
    } finally {
      connect.mockRestore();
    }
  });

  test('a cancelled hold drops the hint after the commit: the seat can be held again at once', async () => {
    const { schedule, seat } = await onSale();
    const [holder, waiting] = await createCustomers(2);
    const { order } = (await book(app, holder.token, schedule.id, { seatIds: [seat.A07] }).expect(201)).body.data;
    await book(app, waiting.token, schedule.id, { seatIds: [seat.A07] }).expect(409);
    expect(await redis.get(hintKey(schedule.id, seat.A07))).toBe('HELD');

    await cancelOrder(app, holder.token, order.id).expect(200);
    await waitFor(async () => (await redis.get(hintKey(schedule.id, seat.A07))) === null);
    await book(app, waiting.token, schedule.id, { seatIds: [seat.A07] }).expect(201);
  });

  test('with Redis down the hint is skipped and PostgreSQL decides alone', async () => {
    const { schedule, seat } = await onSale();
    const [holder, second] = await createCustomers(2);
    await book(app, holder.token, schedule.id, { seatIds: [seat.A08] }).expect(201);
    const mget = jest.spyOn(redis, 'mget').mockRejectedValue(new Error('Connection is closed.'));
    try {
      const refused = await book(app, second.token, schedule.id, { seatIds: [seat.A08] });
      expect(refused.body.error.details).toEqual([{ seatId: seat.A08, status: 'HELD' }]);
    } finally {
      mget.mockRestore();
    }
  });
});

/** afterCommit callbacks run just after the response is sent: wait for the effect. */
async function waitFor(condition, timeoutMs = 2000) {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

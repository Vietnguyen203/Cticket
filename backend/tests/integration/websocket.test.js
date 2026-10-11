const request = require('supertest');
const jwt = require('jsonwebtoken');
const env = require('../../src/config/env');
const { closePool } = require('../../src/database/pool');
const { redis } = require('../../src/redis/client');
const { useFakeMailbox, createLoggedInUser } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, cancelOrder, makeDue } = require('../helpers/orders');
const { startServer, connect } = require('../helpers/ws');
const { expireDueOrders } = require('../../src/modules/orders/order-release');

const mailbox = useFakeMailbox();

let main; // API instance #1 (REST + /ws)
let second; // API instance #2: same Redis, different process state
let admin;
let organizer;
let category;
const clients = [];

beforeAll(async () => {
  main = await startServer();
  second = await startServer();
  admin = await createAdmin(main.app);
  organizer = await createOrganizer(main.app, mailbox, admin.token);
  category = await createCategory(main.app, admin.token);
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.close());
});
afterAll(async () => {
  await main.stop();
  await second.stop();
  await closePool();
});

async function open(server = main, options) {
  const client = await connect(server.url, options);
  clients.push(client);
  await client.waitFor('WELCOME');
  return client;
}

async function onSale() {
  const world = await createConfiguredEvent(main.app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
  });
  await publishEvent(main.app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

async function watch(scheduleId, server = main) {
  const client = await open(server);
  client.send({ type: 'SUBSCRIBE', scheduleId });
  await client.waitFor((m) => m.type === 'SUBSCRIBED' && m.scheduleId === scheduleId);
  return client;
}

const isSeatMessage = (m) => m.type.startsWith('SEAT_');

describe('live seat map (WS-02, WS-03)', () => {
  test('an anonymous viewer sees a seat turn HELD, with a newer version than the seat map', async () => {
    const { schedule, seat } = await onSale();
    const viewer = await watch(schedule.id);
    const map = await request(main.app).get(`/api/v1/schedules/${schedule.id}/seat-map`).expect(200);
    const before = map.body.data.zones.find((z) => z.code === 'A').seats.find((s) => s.code === 'A01');

    const [buyer] = await createCustomers(1);
    await book(main.app, buyer.token, schedule.id, { seatIds: [seat.A01] }).expect(201);

    const message = await viewer.waitFor('SEAT_HELD');
    expect(message).toEqual({
      type: 'SEAT_HELD',
      scheduleId: schedule.id,
      seats: [{ seatId: seat.A01, status: 'HELD', version: expect.any(Number) }],
    });
    expect(message.seats[0].version).toBeGreaterThan(before.version);
  });

  test('a failed booking (rolled back) sends nothing', async () => {
    const { schedule, seat } = await onSale();
    const [first, second] = await createCustomers(2);
    await book(main.app, first.token, schedule.id, { seatIds: [seat.A01] }).expect(201);
    const viewer = await watch(schedule.id);

    await book(main.app, second.token, schedule.id, { seatIds: [seat.A02, seat.A01] }).expect(409);
    await viewer.expectNone(isSeatMessage);
  });

  test('cancel and expiry release seats and GA tickets; only the owner hears about the order', async () => {
    const { schedule, seat, standing } = await onSale();
    const [buyer, stranger] = await createCustomers(2);
    const viewer = await watch(schedule.id);
    const owner = await open();
    owner.send({ type: 'AUTH', token: buyer.token });
    await owner.waitFor('AUTH_OK');
    const other = await open();
    other.send({ type: 'AUTH', token: stranger.token });
    await other.waitFor('AUTH_OK');

    const booked = (await book(main.app, buyer.token, schedule.id, { seatIds: [seat.A01], items: [{ ticketTypeId: standing.id, quantity: 2 }] }).expect(201)).body.data.order;
    await viewer.waitFor('SEAT_HELD');
    expect((await viewer.waitFor('INVENTORY_UPDATED')).ticketTypes).toEqual([{ ticketTypeId: standing.id, available: 98 }]);

    await cancelOrder(main.app, buyer.token, booked.id).expect(200);
    expect((await viewer.waitFor('SEAT_RELEASED')).seats).toEqual([{ seatId: seat.A01, status: 'AVAILABLE', version: expect.any(Number) }]);
    expect((await viewer.waitFor('INVENTORY_UPDATED')).ticketTypes[0].available).toBe(100);
    expect(await owner.waitFor('ORDER_CANCELLED')).toEqual({ type: 'ORDER_CANCELLED', orderId: booked.id, reason: 'USER_CANCELLED' });

    const again = (await book(main.app, buyer.token, schedule.id, { seatIds: [seat.A02] }).expect(201)).body.data.order;
    await makeDue(again.id);
    await expireDueOrders({ scheduleId: schedule.id });
    expect((await viewer.waitFor('SEAT_RELEASED')).seats[0].seatId).toBe(seat.A02);
    expect(await owner.waitFor('ORDER_EXPIRED')).toMatchObject({ orderId: again.id });

    await other.expectNone((m) => m.type.startsWith('ORDER_'));
  });

  test('blocking 10 seats is one message with 10 seats', async () => {
    const { schedule, seats } = await onSale();
    const viewer = await watch(schedule.id);
    const tenSeats = seats.slice(0, 10).map((s) => s.id);

    await request(main.app)
      .post(`/api/v1/schedules/${schedule.id}/inventory/block`)
      .set(bearer(organizer.token))
      .send({ action: 'BLOCK', reason: 'Camera platform', seatIds: tenSeats })
      .expect(200);

    const message = await viewer.waitFor('SEAT_BLOCKED');
    expect(message.seats).toHaveLength(10);
    expect(message.seats.every((s) => s.status === 'BLOCKED')).toBe(true);
    await viewer.expectNone('SEAT_BLOCKED', 200);
  });
});

describe('connecting and authenticating (WS-01)', () => {
  test('bad, revoked and expired tokens are refused; viewing needs no token', async () => {
    const client = await open();
    client.send({ type: 'AUTH', token: 'not-a-jwt' });
    expect((await client.waitFor('ERROR')).code).toBe('UNAUTHENTICATED');

    const user = await createLoggedInUser(main.app, mailbox);
    await request(main.app)
      .post('/api/v1/auth/logout')
      .set(bearer(user.session.accessToken))
      .send({ refreshToken: user.session.refreshToken })
      .expect(204);
    client.send({ type: 'AUTH', token: user.session.accessToken });
    expect((await client.waitFor('ERROR')).code).toBe('TOKEN_REVOKED');

    client.send('{not json');
    expect((await client.waitFor('ERROR')).code).toBe('BAD_MESSAGE');
  });

  test('a token that expires while connected ends the personal room only', async () => {
    const [buyer] = await createCustomers(1);
    const now = Math.floor(Date.now() / 1000);
    const shortLived = jwt.sign({ typ: 'access', roles: ['CUSTOMER'], exp: now + 1 }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      subject: buyer.id,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      jwtid: `short-${now}`,
    });
    const client = await open();
    client.send({ type: 'AUTH', token: shortLived });
    await client.waitFor('AUTH_OK');
    await client.waitFor('AUTH_EXPIRED', 2500);
  });

  test('schedules of an unpublished event cannot be watched', async () => {
    const draft = await createConfiguredEvent(main.app, {
      adminToken: admin.token,
      organizerToken: organizer.token,
      categoryId: category.id,
    });
    const client = await open();
    client.send({ type: 'SUBSCRIBE', scheduleId: draft.schedule.id });
    expect((await client.waitFor('ERROR')).code).toBe('NOT_FOUND');
    client.send({ type: 'SUBSCRIBE', scheduleId: 'not-a-uuid' });
    expect((await client.waitFor('ERROR')).code).toBe('BAD_MESSAGE');
  });

  test('wrong path → 404; a browser from an unknown website → 403', async () => {
    await expect(connect(main.url.replace('/ws', '/other'))).rejects.toThrow('HTTP 404');
    await expect(connect(main.url, { origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');
  });
});

describe('protection limits', () => {
  test('heartbeat: a client that stops answering pings is disconnected', async () => {
    const server = await startServer({ heartbeatMs: 100 });
    try {
      const silent = await connect(server.url, { autoPong: false });
      expect(await silent.closed).toBe(1006); // terminated by the server
    } finally {
      await server.stop();
    }
  });

  test('too many subscriptions, too many messages and too many connections per IP', async () => {
    const server = await startServer({ limits: { maxSubscriptions: 1, maxMessages: 5, maxConnectionsPerIp: 2 } });
    try {
      const { schedule } = await onSale();
      const other = await onSale();
      const client = await connect(server.url);
      client.send({ type: 'SUBSCRIBE', scheduleId: schedule.id });
      await client.waitFor('SUBSCRIBED');
      client.send({ type: 'SUBSCRIBE', scheduleId: other.schedule.id });
      expect((await client.waitFor('ERROR')).code).toBe('SUBSCRIPTION_LIMIT');

      const second = await connect(server.url);
      await expect(connect(server.url)).rejects.toThrow('HTTP 429');
      for (let i = 0; i < 6; i += 1) second.send({ type: 'UNSUBSCRIBE', scheduleId: schedule.id });
      expect(await second.closed).toBe(1008);
      client.close();
    } finally {
      await server.stop();
    }
  });
});

describe('several API instances (WS-05)', () => {
  test('a booking on instance #1 reaches a viewer connected to instance #2', async () => {
    const { schedule, seat } = await onSale();
    const viewerOnSecond = await watch(schedule.id, second);
    const [buyer] = await createCustomers(1);
    await book(main.app, buyer.token, schedule.id, { seatIds: [seat.B01] }).expect(201);
    expect((await viewerOnSecond.waitFor('SEAT_HELD')).seats[0].seatId).toBe(seat.B01);
  });

  test('with Redis down, the booking still works and local viewers still get the update', async () => {
    const { schedule, seat } = await onSale();
    const viewer = await watch(schedule.id);
    const [buyer] = await createCustomers(1);
    const spy = jest.spyOn(redis, 'publish').mockRejectedValue(new Error('Connection is closed.'));
    try {
      await book(main.app, buyer.token, schedule.id, { seatIds: [seat.B02] }).expect(201);
      expect((await viewer.waitFor('SEAT_HELD')).seats[0].seatId).toBe(seat.B02);
    } finally {
      spy.mockRestore();
    }
  });
});

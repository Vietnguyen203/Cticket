const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { redis } = require('../../src/redis/client');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory, changeStatus } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book } = require('../helpers/orders');

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

async function publishedEvent() {
  const world = await createConfiguredEvent(app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
  });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  return world;
}

/** Change a row behind the API's back: only a cache explains the API still showing the old value. */
const renameEventInDatabase = (eventId, title) => query(`UPDATE events SET title = $2 WHERE id = $1`, [eventId, title]);

describe('cache-aside with versioned invalidation', () => {
  test('categories: served from the cache, refreshed when a category changes through the API', async () => {
    await request(app).get('/api/v1/categories').expect(200); // warm the cache
    await query(`INSERT INTO categories (name, slug) VALUES ('Behind the API', $1)`, [`behind-${Date.now()}`]);

    const cached = await request(app).get('/api/v1/categories').expect(200);
    expect(cached.body.data.categories.map((c) => c.name)).not.toContain('Behind the API');

    await createCategory(app, admin.token); // bumps the version after commit
    const fresh = await request(app).get('/api/v1/categories').expect(200);
    expect(fresh.body.data.categories.map((c) => c.name)).toContain('Behind the API');
  });

  test('event page: cached by id and by slug; an edit through the API refreshes both', async () => {
    const { event } = await publishedEvent();
    await request(app).get(`/api/v1/events/${event.id}`).expect(200);
    await request(app).get(`/api/v1/events/${event.slug}`).expect(200);

    await renameEventInDatabase(event.id, 'Renamed behind the API');
    expect((await request(app).get(`/api/v1/events/${event.id}`)).body.data.event.title).toBe(event.title);

    await request(app).patch(`/api/v1/events/${event.id}`).set(bearer(organizer.token)).send({ description: 'New' }).expect(200);
    for (const key of [event.id, event.slug]) {
      const res = await request(app).get(`/api/v1/events/${key}`).expect(200);
      expect(res.body.data.event).toMatchObject({ title: 'Renamed behind the API', description: 'New' });
    }
  });

  test('a DRAFT is never cached: its owner sees it, the public never does', async () => {
    const draft = await createConfiguredEvent(app, {
      adminToken: admin.token,
      organizerToken: organizer.token,
      categoryId: category.id,
    });
    await request(app).get(`/api/v1/events/${draft.event.id}`).set(bearer(organizer.token)).expect(200);
    await request(app).get(`/api/v1/events/${draft.event.id}`).expect(404);
    await request(app).get(`/api/v1/events/${draft.event.id}/schedules`).expect(404);
  });

  test('public event list: a cancelled event disappears right away', async () => {
    const { event } = await publishedEvent();
    const list = () => request(app).get(`/api/v1/events?categoryId=${category.id}&pageSize=50`).expect(200);
    expect((await list()).body.data.events.map((e) => e.id)).toContain(event.id);

    await changeStatus(app, organizer.token, event.id, 'CANCELLED', 'Venue flooded').expect(200);
    expect((await list()).body.data.events.map((e) => e.id)).not.toContain(event.id);
  });

  test('seat map: the layout is cached, seat statuses are always live', async () => {
    const { schedule, seats } = await publishedEvent();
    const seatMap = async () => {
      const res = await request(app).get(`/api/v1/schedules/${schedule.id}/seat-map`).expect(200);
      return res.body.data.zones.find((z) => z.code === 'A').seats.find((s) => s.code === 'A01');
    };
    expect(await seatMap()).toMatchObject({ status: 'AVAILABLE', price: 2_000_000 });

    const [buyer] = await createCustomers(1);
    await book(app, buyer.token, schedule.id, { seatIds: [seats[0].id] }).expect(201);
    expect((await seatMap()).status).toBe('HELD'); // no waiting for any TTL
  });

  test('venue layout: a new zone shows up immediately', async () => {
    const { venue } = await publishedEvent();
    const zoneCodes = async () =>
      (await request(app).get(`/api/v1/venues/${venue.id}/layout`).expect(200)).body.data.zones.map((z) => z.code);
    expect(await zoneCodes()).not.toContain('VIP');

    await request(app)
      .post(`/api/v1/venues/${venue.id}/zones`)
      .set(bearer(admin.token))
      .send({ code: 'VIP', name: 'VIP', kind: 'STANDING', capacity: 20 })
      .expect(201);
    expect(await zoneCodes()).toContain('VIP');
  });

  test('if Redis is down, everything is served from PostgreSQL', async () => {
    const { event } = await publishedEvent();
    const spies = ['get', 'set', 'multi'].map((command) =>
      jest.spyOn(redis, command).mockImplementation(() => {
        throw new Error('Connection is closed.');
      }),
    );
    try {
      await renameEventInDatabase(event.id, 'Fresh from PostgreSQL');
      const res = await request(app).get(`/api/v1/events/${event.id}`).expect(200);
      expect(res.body.data.event.title).toBe('Fresh from PostgreSQL');
      await request(app).get('/api/v1/categories').expect(200);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

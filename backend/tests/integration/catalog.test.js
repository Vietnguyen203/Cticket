const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { useFakeMailbox, createLoggedInUser } = require('../helpers/auth');
const { bearer, unique, createAdmin, createVenue, createOrganizer, createEvent } = require('../helpers/catalog');

const app = createApp();
const mailbox = useFakeMailbox();
let admin;
let customer;

beforeAll(async () => {
  admin = await createAdmin(app);
  customer = await createLoggedInUser(app, mailbox);
});
afterAll(() => closePool());

describe('categories', () => {
  const api = '/api/v1/categories';

  test('anyone can list; only admins can create', async () => {
    await request(app).get(api).expect(200);
    const res = await request(app).post(api).set(bearer(customer.session.accessToken)).send({ name: 'Hacking' });
    expect(res.status).toBe(403);
  });

  test('slug is generated from a Vietnamese name; duplicates are rejected', async () => {
    const name = `Âm nhạc & Lễ hội ${unique()}`;
    const created = await request(app).post(api).set(bearer(admin.token)).send({ name }).expect(201);
    expect(created.body.data.category.slug).toMatch(/^am-nhac-le-hoi-[a-f0-9]+$/);

    const duplicate = await request(app).post(api).set(bearer(admin.token)).send({ name });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CATEGORY_SLUG_TAKEN');

    // The slug always comes from the name: one sent by the caller is ignored, on create and on update.
    const other = `Thể thao ${unique()}`;
    const typed = await request(app).post(api).set(bearer(admin.token)).send({ name: other, slug: 'anything-i-like' }).expect(201);
    expect(typed.body.data.category.slug).toBe(`the-thao-${other.split(' ').at(-1)}`);
    await request(app).patch(`${api}/${typed.body.data.category.id}`).set(bearer(admin.token)).send({ slug: 'anything-i-like' }).expect(400);
  });

  test('update and delete; unknown id → 404', async () => {
    const { body } = await request(app).post(api).set(bearer(admin.token)).send({ name: `Sports ${unique()}` }).expect(201);
    const id = body.data.category.id;

    const updated = await request(app).patch(`${api}/${id}`).set(bearer(admin.token)).send({ description: 'Live sport' });
    expect(updated.body.data.category.description).toBe('Live sport');

    await request(app).delete(`${api}/${id}`).set(bearer(admin.token)).expect(204);
    await request(app).delete(`${api}/${id}`).set(bearer(admin.token)).expect(404);
  });

  test('admin page: events per category; a rename moves the slug along; names stay unique', async () => {
    const used = (await request(app).post(api).set(bearer(admin.token)).send({ name: `Booking ${unique()}` }).expect(201)).body.data.category;
    const other = (await request(app).post(api).set(bearer(admin.token)).send({ name: `Kịch ${unique()}` }).expect(201)).body.data.category;
    const organizer = await createOrganizer(app, mailbox, admin.token);
    await createEvent(app, organizer.token, { categoryIds: [used.id] });

    const usage = (await request(app).get(`${api}/usage`).set(bearer(admin.token)).expect(200)).body.data.usage;
    expect(usage).toContainEqual({ categoryId: used.id, events: 1 });
    expect(usage.find((u) => u.categoryId === other.id)).toBeUndefined();
    await request(app).get(`${api}/usage`).set(bearer(organizer.token)).expect(403);

    const name = `Hòa nhạc ${unique()}`;
    const renamed = await request(app)
      .patch(`${api}/${used.id}`)
      .set(bearer(admin.token))
      .send({ name, description: 'Nhạc giao hưởng, thính phòng' })
      .expect(200);
    expect(renamed.body.data.category).toMatchObject({ name, slug: `hoa-nhac-${name.split(' ').at(-1)}`, description: 'Nhạc giao hưởng, thính phòng' });
    const taken = await request(app).patch(`${api}/${other.id}`).set(bearer(admin.token)).send({ name });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('CATEGORY_SLUG_TAKEN');

  });

  test('a category in use can be deleted: it is taken off its events first, audited', async () => {
    const doomed = (await request(app).post(api).set(bearer(admin.token)).send({ name: `Tạm ${unique()}` }).expect(201)).body.data.category;
    const kept = (await request(app).post(api).set(bearer(admin.token)).send({ name: `Giữ ${unique()}` }).expect(201)).body.data.category;
    const organizer = await createOrganizer(app, mailbox, admin.token);
    const onlyDoomed = await createEvent(app, organizer.token, { categoryIds: [doomed.id] });
    const both = await createEvent(app, organizer.token, { categoryIds: [doomed.id, kept.id] });

    await request(app).delete(`${api}/${doomed.id}`).set(bearer(organizer.token)).expect(403);
    await request(app).delete(`${api}/${doomed.id}`).set(bearer(admin.token)).expect(204);

    const categoriesOf = async (eventId) =>
      (await request(app).get(`/api/v1/events/${eventId}`).set(bearer(organizer.token)).expect(200)).body.data.event.categories.map((c) => c.id);
    expect(await categoriesOf(onlyDoomed.id)).toEqual([]);
    expect(await categoriesOf(both.id)).toEqual([kept.id]);
    const list = (await request(app).get(api).expect(200)).body.data.categories;
    expect(list.find((c) => c.id === doomed.id)).toBeUndefined();

    const { rows } = await query(`SELECT action, old_value, new_value FROM audit_logs WHERE entity_id = $1`, [doomed.id]);
    expect(rows).toEqual([{ action: 'CATEGORY_DELETED', old_value: expect.objectContaining({ name: doomed.name }), new_value: { removedFromEvents: 2 } }]);
  });
});

describe('venues', () => {
  const api = '/api/v1/venues';

  test('only admins can create; validation rejects impossible coordinates', async () => {
    await request(app)
      .post(api)
      .set(bearer(customer.session.accessToken))
      .send({ name: 'X', addressLine: 'Y', city: 'Z' })
      .expect(403);

    const res = await request(app)
      .post(api)
      .set(bearer(admin.token))
      .send({ name: 'X', addressLine: 'Y', city: 'Z', latitude: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('body.latitude');
  });

  test('accent-insensitive search: "nha hat lon" finds "Nhà hát Lớn"', async () => {
    const tag = unique();
    const venue = await createVenue(app, admin.token, { name: `Nhà hát Lớn ${tag}`, city: 'Hà Nội' });

    const res = await request(app).get(api).query({ q: `nha hat lon ${tag}`, city: 'ha noi' }).expect(200);
    expect(res.body.data.venues.map((v) => v.id)).toEqual([venue.id]);
    expect(res.body.meta).toMatchObject({ page: 1, total: 1 });
  });

  test('an INACTIVE venue is hidden from the public but visible to admins', async () => {
    const venue = await createVenue(app, admin.token);
    await request(app).patch(`${api}/${venue.id}`).set(bearer(admin.token)).send({ status: 'INACTIVE' }).expect(200);

    await request(app).get(`${api}/${venue.id}`).expect(404);
    await request(app).get(`${api}/${venue.id}`).set(bearer(admin.token)).expect(200);

    const publicList = await request(app).get(api).query({ q: venue.name });
    expect(publicList.body.data.venues).toHaveLength(0);
    const adminList = await request(app).get(api).set(bearer(admin.token)).query({ q: venue.name, includeInactive: 'true' });
    expect(adminList.body.data.venues).toHaveLength(1);
  });
});

const request = require('supertest');
const { createApp } = require('../../src/app');
const { closePool } = require('../../src/database/pool');
const { useFakeMailbox, createLoggedInUser } = require('../helpers/auth');
const { bearer, unique, createAdmin, createVenue } = require('../helpers/catalog');

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
  });

  test('update and delete; unknown id → 404', async () => {
    const { body } = await request(app).post(api).set(bearer(admin.token)).send({ name: `Sports ${unique()}` }).expect(201);
    const id = body.data.category.id;

    const updated = await request(app).patch(`${api}/${id}`).set(bearer(admin.token)).send({ description: 'Live sport' });
    expect(updated.body.data.category.description).toBe('Live sport');

    await request(app).delete(`${api}/${id}`).set(bearer(admin.token)).expect(204);
    await request(app).delete(`${api}/${id}`).set(bearer(admin.token)).expect(404);
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

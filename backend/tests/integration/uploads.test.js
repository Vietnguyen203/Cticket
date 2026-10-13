const request = require('supertest');
const { createApp } = require('../../src/app');
const { closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory, createEvent } = require('../helpers/catalog');
const { createCustomers } = require('../helpers/orders');

const app = createApp();
const mailbox = useFakeMailbox();

let organizer;
let category;

beforeAll(async () => {
  const admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  category = await createCategory(app, admin.token);
});
afterAll(() => closePool());

// A real 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const upload = (token, body, contentType = 'image/png') =>
  request(app).post('/api/v1/uploads/images').set(bearer(token)).set('Content-Type', contentType).send(body);

describe('event images uploaded from the computer (Phase 12.2)', () => {
  test('an organizer uploads a PNG; it is served back with its real type, cached, nosniff', async () => {
    const res = await upload(organizer.token, PNG).expect(201);
    expect(res.body.data.image).toEqual({
      url: expect.stringMatching(/^\/api\/v1\/uploads\/images\/[0-9a-f-]{36}\.png$/),
      contentType: 'image/png',
      size: PNG.length,
    });

    const file = await request(app).get(res.body.data.image.url).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toMatch(/immutable/);
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  test('the type comes from the bytes, not from the header: an HTML page sent as image/png is refused', async () => {
    const res = await upload(organizer.token, Buffer.from('<html><script>alert(1)</script></html>')).expect(422);
    expect(res.body.error.code).toBe('IMAGE_INVALID');
    // SVG (can carry scripts) and other types are not accepted at all.
    await upload(organizer.token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml').expect(422);
  });

  test('at most 5 MB; customers cannot upload', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload(organizer.token, big).expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');

    const [customer] = await createCustomers(1);
    await upload(customer.token, PNG).expect(403);
    await request(app).post('/api/v1/uploads/images').set('Content-Type', 'image/png').send(PNG).expect(401);
  });

  test('an uploaded image can be an event banner; other paths on this site cannot', async () => {
    const { url } = (await upload(organizer.token, PNG).expect(201)).body.data.image;
    const event = await createEvent(app, organizer.token, { categoryIds: [category.id], bannerUrl: url, thumbnailUrl: url });
    expect(event.bannerUrl).toBe(url);

    const res = await request(app)
      .post('/api/v1/events')
      .set(bearer(organizer.token))
      .send({ title: 'Đường dẫn lạ', categoryIds: [category.id], bannerUrl: '/api/v1/users/me' });
    expect(res.status).toBe(400);
  });

  test('unknown files are 404, and no path can escape the upload folder', async () => {
    await request(app).get('/api/v1/uploads/images/00000000-0000-0000-0000-000000000000.png').expect(404);
    const escape = await request(app).get('/api/v1/uploads/images/..%2f..%2fpackage.json');
    expect([400, 403, 404]).toContain(escape.status);
  });
});

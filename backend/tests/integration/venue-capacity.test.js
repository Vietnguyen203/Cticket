const request = require('supertest');
const { createApp } = require('../../src/app');
const { closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, at, createAdmin, createOrganizer, createCategory, createVenue, createEvent } = require('../helpers/catalog');

/**
 * "Sức chứa" of a venue is the ceiling: its zones (seats + standing places)
 * and a show's total attendance never go above it.
 */
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

const asAdmin = (req) => req.set(bearer(admin.token));
const addZone = (venueId, body) => asAdmin(request(app).post(`/api/v1/venues/${venueId}/zones`)).send(body);

test('zones fit in the venue: standing places and seats count, the last place too', async () => {
  const venue = await createVenue(app, admin.token, { capacity: 100 });
  const pit = await addZone(venue.id, { code: 'PIT', name: 'Đứng', kind: 'STANDING', capacity: 80 }).expect(201);
  const seated = await addZone(venue.id, { code: 'A', name: 'Khu A', kind: 'SEATED' }).expect(201);

  const tooManySeats = await asAdmin(request(app).post(`/api/v1/zones/${seated.body.data.zone.id}/seats/bulk`)).send({
    rows: [{ rowLabel: 'A', from: 1, to: 21 }],
  });
  expect(tooManySeats.status).toBe(422);
  expect(tooManySeats.body.error.code).toBe('VENUE_CAPACITY_EXCEEDED');
  expect(tooManySeats.body.error.details[0]).toMatchObject({ capacity: 100, used: 80, adding: 21 });
  await asAdmin(request(app).post(`/api/v1/zones/${seated.body.data.zone.id}/seats/bulk`))
    .send({ rows: [{ rowLabel: 'A', from: 1, to: 20 }] })
    .expect(201);

  // Full: no new standing zone, no bigger standing zone, no smaller venue.
  expect((await addZone(venue.id, { code: 'B', name: 'Đứng 2', kind: 'STANDING', capacity: 1 })).body.error.code).toBe('VENUE_CAPACITY_EXCEEDED');
  const bigger = await asAdmin(request(app).patch(`/api/v1/zones/${pit.body.data.zone.id}`)).send({ capacity: 81 });
  expect(bigger.body.error.code).toBe('VENUE_CAPACITY_EXCEEDED');
  await asAdmin(request(app).patch(`/api/v1/zones/${pit.body.data.zone.id}`)).send({ capacity: 70 }).expect(200);
  const smaller = await asAdmin(request(app).patch(`/api/v1/venues/${venue.id}`)).send({ capacity: 89 });
  expect(smaller.body.error.code).toBe('VENUE_CAPACITY_EXCEEDED');
  await asAdmin(request(app).patch(`/api/v1/venues/${venue.id}`)).send({ capacity: 90 }).expect(200);

  const layout = await request(app).get(`/api/v1/venues/${venue.id}/layout`).expect(200);
  expect(layout.body.data.venue.capacity).toBe(90);
});

test("a show's total attendance fits in its venue", async () => {
  const venue = await createVenue(app, admin.token, { capacity: 300 });
  const event = await createEvent(app, organizer.token, { categoryIds: [category.id] });
  const add = (capacity) =>
    request(app)
      .post(`/api/v1/events/${event.id}/schedules`)
      .set(bearer(organizer.token))
      .send({ venueId: venue.id, startAt: at(70, 12), endAt: at(70, 14), capacity });

  const tooMany = await add(301);
  expect(tooMany.status).toBe(422);
  expect(tooMany.body.error.code).toBe('VENUE_CAPACITY_EXCEEDED');
  const show = (await add(300).expect(201)).body.data.schedule;

  const raised = await request(app).patch(`/api/v1/schedules/${show.id}`).set(bearer(organizer.token)).send({ capacity: 301 });
  expect(raised.body.error.code).toBe('VENUE_CAPACITY_EXCEEDED');
});

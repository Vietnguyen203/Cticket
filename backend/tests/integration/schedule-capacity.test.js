const request = require('supertest');
const { createApp } = require('../../src/app');
const { closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, at, createAdmin, createOrganizer, createCategory, createVenue, createEvent, addTicketType } = require('../helpers/catalog');
const { createSeatedVenue } = require('../helpers/inventory');

/**
 * "Tổng số người tham dự": a show is planned for N people, split into seated
 * tiers (seats of the venue) and standing tiers. Together they never hold
 * more than N.
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

async function showFor(capacity, day) {
  const layout = await createSeatedVenue(app, admin.token); // 20 seats (rows A, B) + a standing zone of 100
  const event = await createEvent(app, organizer.token, { categoryIds: [category.id] });
  const res = await request(app)
    .post(`/api/v1/events/${event.id}/schedules`)
    .set(bearer(organizer.token))
    .send({ venueId: layout.venue.id, startAt: at(day, 12), endAt: at(day, 14), capacity })
    .expect(201);
  return { ...layout, schedule: res.body.data.schedule };
}

const patchSchedule = (id, body) => request(app).patch(`/api/v1/schedules/${id}`).set(bearer(organizer.token)).send(body);
const putPlan = (scheduleId, assignments) =>
  request(app).put(`/api/v1/schedules/${scheduleId}/seat-plan`).set(bearer(organizer.token)).send({ assignments });

test('the total is stored with the show and can be changed while a draft', async () => {
  const { schedule } = await showFor(30, 20);
  expect(schedule.capacity).toBe(30);
  const changed = await patchSchedule(schedule.id, { capacity: 40 }).expect(200);
  expect(changed.body.data.schedule.capacity).toBe(40);
});

test('seated + standing tiers fit in the total; the last place counts', async () => {
  const { schedule, pitId, seats } = await showFor(30, 21);
  const vip = (await addTicketType(app, organizer.token, schedule.id, { code: 'VIP', name: 'VIP', price: 1, inventoryMode: 'RESERVED' }).expect(201)).body.data
    .ticketType;
  await putPlan(schedule.id, [{ ticketTypeId: vip.id, seatIds: seats.slice(0, 10).map((s) => s.id) }]).expect(200);

  const tooMany = await addTicketType(app, organizer.token, schedule.id, {
    code: 'GA', name: 'Đứng', price: 1, inventoryMode: 'GENERAL_ADMISSION', capacity: 21, venueZoneId: pitId,
  });
  expect(tooMany.status).toBe(422);
  expect(tooMany.body.error.code).toBe('CAPACITY_EXCEEDED');
  expect(tooMany.body.error.details[0]).toMatchObject({ capacity: 30, allocated: 31 });

  await addTicketType(app, organizer.token, schedule.id, {
    code: 'GA', name: 'Đứng', price: 1, inventoryMode: 'GENERAL_ADMISSION', capacity: 20, venueZoneId: pitId,
  }).expect(201);

  // Now full: more seats for VIP do not fit, nor a smaller total.
  const moreSeats = await putPlan(schedule.id, [{ ticketTypeId: vip.id, seatIds: seats.slice(0, 11).map((s) => s.id) }]);
  expect(moreSeats.body.error.code).toBe('CAPACITY_EXCEEDED');
  const smaller = await patchSchedule(schedule.id, { capacity: 29 });
  expect(smaller.body.error.code).toBe('CAPACITY_EXCEEDED');
  await patchSchedule(schedule.id, { capacity: 30 }).expect(200);
});

test('in step with the venue: without a total, the show takes the venue capacity; a venue without one leaves it open', async () => {
  const { schedule } = await showFor(undefined, 22);
  expect(schedule.capacity).toBe(500); // createSeatedVenue: a venue of 500

  const open = await createVenue(app, admin.token, { capacity: null });
  const event = await createEvent(app, organizer.token, { categoryIds: [category.id] });
  const res = await request(app)
    .post(`/api/v1/events/${event.id}/schedules`)
    .set(bearer(organizer.token))
    .send({ venueId: open.id, startAt: at(23, 12), endAt: at(23, 14) })
    .expect(201);
  expect(res.body.data.schedule.capacity).toBeNull();
});

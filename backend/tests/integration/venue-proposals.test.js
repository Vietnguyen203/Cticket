const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, at, createAdmin, createOrganizer, createCategory, createEvent, addSchedule, addGaTicketType, changeStatus } = require('../helpers/catalog');
const { createCustomers } = require('../helpers/orders');

const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizer;
let otherOrganizer;
let category;

beforeAll(async () => {
  admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  otherOrganizer = await createOrganizer(app, mailbox, admin.token);
  category = await createCategory(app, admin.token);
});
afterAll(() => closePool());

const propose = (token, name = `Sân khấu đề xuất ${Date.now()}`) =>
  request(app).post('/api/v1/venues').set(bearer(token)).send({ name, addressLine: '1 Nguyễn Huệ', city: 'Hồ Chí Minh' });
const listVenues = (token, qs = '') => {
  const req = request(app).get(`/api/v1/venues?pageSize=50${qs}`);
  return (token ? req.set(bearer(token)) : req).expect(200).then((res) => res.body.data.venues.map((v) => v.id));
};
const addZone = (token, venueId, body = { code: 'GA', name: 'Khu đứng', kind: 'STANDING', capacity: 100 }) =>
  request(app).post(`/api/v1/venues/${venueId}/zones`).set(bearer(token)).send(body);

/** A DRAFT event of `owner` with one schedule at `venueId` and one GA ticket type, submitted. */
async function submittedEventAt(owner, venueId) {
  const event = await createEvent(app, owner.token, { categoryIds: [category.id] });
  const schedule = await addSchedule(app, owner.token, event.id, { venueId, startAt: at(20, 12), endAt: at(20, 14) }).expect(201);
  await addGaTicketType(app, owner.token, schedule.body.data.schedule.id);
  await changeStatus(app, owner.token, event.id, 'PENDING_APPROVAL').expect(200);
  return event;
}

describe('organizers propose venues (Phase 12.2)', () => {
  test('a proposed venue is PENDING and visible only to its organizer and admins', async () => {
    const res = await propose(organizer.token).expect(201);
    const venue = res.body.data.venue;
    expect(venue).toMatchObject({ status: 'PENDING', createdByOrganizerId: organizer.organizerId });

    expect(await listVenues(null)).not.toContain(venue.id);
    expect(await listVenues(otherOrganizer.token)).not.toContain(venue.id);
    expect(await listVenues(organizer.token)).toContain(venue.id);
    expect(await listVenues(admin.token, '&status=PENDING')).toContain(venue.id);

    await request(app).get(`/api/v1/venues/${venue.id}`).expect(404);
    await request(app).get(`/api/v1/venues/${venue.id}`).set(bearer(otherOrganizer.token)).expect(404);
    await request(app).get(`/api/v1/venues/${venue.id}/layout`).set(bearer(organizer.token)).expect(200);

    const [customer] = await createCustomers(1);
    await propose(customer.token).expect(403); // no venue:propose
  });

  test('the proposer builds zones and seats until the venue is approved; nobody else can', async () => {
    const venue = (await propose(organizer.token).expect(201)).body.data.venue;
    const zone = (await addZone(organizer.token, venue.id, { code: 'A', name: 'Khu A', kind: 'SEATED' }).expect(201)).body.data.zone;
    await request(app)
      .post(`/api/v1/zones/${zone.id}/seats/bulk`)
      .set(bearer(organizer.token))
      .send({ rows: [{ rowLabel: 'A', from: 1, to: 5 }] })
      .expect(201);
    await addZone(otherOrganizer.token, venue.id).expect(404);

    await request(app).patch(`/api/v1/venues/${venue.id}`).set(bearer(admin.token)).send({ status: 'ACTIVE' }).expect(200);
    const late = await addZone(organizer.token, venue.id).expect(403);
    expect(late.body.error.code).toBe('FORBIDDEN');
    await addZone(admin.token, venue.id).expect(201);
  });

  test("only the proposer's events may use a PENDING venue", async () => {
    const venue = (await propose(organizer.token).expect(201)).body.data.venue;
    const mine = await createEvent(app, organizer.token, { categoryIds: [category.id] });
    await addSchedule(app, organizer.token, mine.id, { venueId: venue.id, startAt: at(20, 12), endAt: at(20, 14) }).expect(201);

    const theirs = await createEvent(app, otherOrganizer.token, { categoryIds: [category.id] });
    const refused = await addSchedule(app, otherOrganizer.token, theirs.id, { venueId: venue.id, startAt: at(21, 12), endAt: at(21, 14) });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('VENUE_NOT_AVAILABLE');
  });

  test('approving the event approves its proposed venue, audited; then everyone sees the venue', async () => {
    const venue = (await propose(organizer.token).expect(201)).body.data.venue;
    await addZone(organizer.token, venue.id).expect(201);
    const event = await submittedEventAt(organizer, venue.id);

    await changeStatus(app, admin.token, event.id, 'PUBLISHED').expect(200);

    const { rows } = await query(`SELECT status FROM venues WHERE id = $1`, [venue.id]);
    expect(rows[0].status).toBe('ACTIVE');
    const audit = await query(`SELECT new_value FROM audit_logs WHERE entity_id = $1 AND action = 'VENUE_APPROVED'`, [venue.id]);
    expect(audit.rows[0].new_value).toMatchObject({ status: 'ACTIVE', eventId: event.id });
    expect(await listVenues(null)).toContain(venue.id);
  });

  test('a venue the admin rejected blocks the approval of the event', async () => {
    const venue = (await propose(organizer.token).expect(201)).body.data.venue;
    await addZone(organizer.token, venue.id).expect(201);
    const event = await submittedEventAt(organizer, venue.id);
    await request(app).patch(`/api/v1/venues/${venue.id}`).set(bearer(admin.token)).send({ status: 'INACTIVE' }).expect(200);

    const res = await changeStatus(app, admin.token, event.id, 'PUBLISHED');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VENUE_NOT_AVAILABLE');
    const { rows } = await query(`SELECT status FROM events WHERE id = $1`, [event.id]);
    expect(rows[0].status).toBe('PENDING_APPROVAL'); // nothing changed
  });
});

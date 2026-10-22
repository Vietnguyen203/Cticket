const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { useFakeMailbox, createLoggedInUser } = require('../helpers/auth');
const {
  bearer,
  createAdmin,
  createOrganizer,
  createCategory,
  createVenue,
  createEvent,
  addSchedule,
  addGaTicketType,
  at,
  changeStatus,
  createPublishedEvent,
} = require('../helpers/catalog');

/**
 * The performance programme ("Lịch trình biểu diễn"): artists in order, an
 * optional planned time typed on a 24-hour clock, a note. Information for
 * buyers: editable in DRAFT and while on sale, shown on the public page.
 */
const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizer;
let other;
let customer;
let category;
let venue;

beforeAll(async () => {
  admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  other = await createOrganizer(app, mailbox, admin.token);
  customer = await createLoggedInUser(app, mailbox);
  category = await createCategory(app, admin.token);
  venue = await createVenue(app, admin.token);
});
afterAll(() => closePool());

const patch = (eventId, token, body) => request(app).patch(`/api/v1/events/${eventId}`).set(bearer(token)).send(body);

const LINEUP = [
  { artist: 'Ban nhạc mở màn', time: '19:00' },
  { artist: 'Hà Anh Tuấn', time: '20:15', note: 'Khách mời: Phương Linh' },
  { artist: 'Giao lưu cuối chương trình' },
];

test('a new event has an empty programme; the organizer sets it, in order, times on a 24-hour clock', async () => {
  const event = await createEvent(app, organizer.token, { categoryIds: [category.id] });
  expect(event.lineup).toEqual([]);

  const res = await patch(event.id, organizer.token, { lineup: LINEUP }).expect(200);
  expect(res.body.data.event.lineup).toEqual([
    { artist: 'Ban nhạc mở màn', time: '19:00', note: null },
    { artist: 'Hà Anh Tuấn', time: '20:15', note: 'Khách mời: Phương Linh' },
    { artist: 'Giao lưu cuối chương trình', time: null, note: null },
  ]);
  // Keys in a fixed order (jsonb itself reorders them; the editor compares what it saved).
  expect(Object.keys(res.body.data.event.lineup[1])).toEqual(['artist', 'time', 'note']);
  // Stored as JSON (not a PostgreSQL array).
  const { rows } = await query(`SELECT jsonb_typeof(lineup) AS kind, jsonb_array_length(lineup) AS n FROM events WHERE id = $1`, [event.id]);
  expect(rows[0]).toEqual({ kind: 'array', n: 3 });
});

test('a time that is not 24-hour HH:mm is refused with the field named; nothing changes', async () => {
  const event = await createEvent(app, organizer.token, { categoryIds: [category.id] });
  for (const time of ['24:00', '7:30 PM', '19:60', '1930']) {
    const res = await patch(event.id, organizer.token, { lineup: [{ artist: 'A', time }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('body.lineup.0.time');
  }
  for (const lineup of [[{ artist: ' ' }], [{ artist: 'A', extra: 1 }], Array.from({ length: 51 }, (_, i) => ({ artist: `N${i}` }))]) {
    expect((await patch(event.id, organizer.token, { lineup })).status).toBe(400);
  }
  const { rows } = await query(`SELECT lineup FROM events WHERE id = $1`, [event.id]);
  expect(rows[0].lineup).toEqual([]);
});

test('editable while on sale (the public page shows it at once); not while waiting for approval', async () => {
  const event = await createPublishedEvent(app, { organizer, adminToken: admin.token, categoryIds: [category.id], venueId: venue.id });
  await request(app).get(`/api/v1/events/${event.slug}`).expect(200); // cached now

  await patch(event.id, organizer.token, { lineup: LINEUP }).expect(200);
  const page = await request(app).get(`/api/v1/events/${event.slug}`).expect(200);
  expect(page.body.data.event.lineup.map((item) => item.artist)).toEqual(LINEUP.map((item) => item.artist));

  const draft = await createEvent(app, organizer.token, { categoryIds: [category.id] });
  await patch(draft.id, organizer.token, { lineup: LINEUP }).expect(200);
  const schedule = await addSchedule(app, organizer.token, draft.id, { venueId: venue.id, startAt: at(40, 12), endAt: at(40, 14) }).expect(201); // another day: the venue is taken on day 30
  await addGaTicketType(app, organizer.token, schedule.body.data.schedule.id);
  await changeStatus(app, organizer.token, draft.id, 'PENDING_APPROVAL').expect(200);
  const pending = await patch(draft.id, organizer.token, { lineup: [] });
  expect(pending.status).toBe(422);
  expect(pending.body.error.code).toBe('EVENT_NOT_EDITABLE');
});

test('only the owning organizer (or an admin) changes it', async () => {
  const event = await createEvent(app, organizer.token, { categoryIds: [category.id] });
  expect((await patch(event.id, other.token, { lineup: LINEUP })).status).toBe(404);
  expect((await patch(event.id, customer.session.accessToken, { lineup: LINEUP })).status).toBe(403);
  await patch(event.id, admin.token, { lineup: LINEUP.slice(0, 1) }).expect(200);
});

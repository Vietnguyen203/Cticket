const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { useFakeMailbox, createLoggedInUser } = require('../helpers/auth');
const {
  bearer,
  unique,
  at,
  createAdmin,
  createOrganizer,
  createCategory,
  createVenue,
  createEvent,
  addSchedule,
  changeStatus,
  addGaTicketType,
  createPublishedEvent,
} = require('../helpers/catalog');

const app = createApp();
const mailbox = useFakeMailbox();
const api = '/api/v1/events';

let admin;
let organizerA;
let organizerB;
let customer;
let category;

beforeAll(async () => {
  admin = await createAdmin(app);
  organizerA = await createOrganizer(app, mailbox, admin.token);
  organizerB = await createOrganizer(app, mailbox, admin.token);
  customer = await createLoggedInUser(app, mailbox);
  category = await createCategory(app, admin.token);
});
afterAll(() => closePool());

const getEvent = (idOrSlug, token) => {
  const req = request(app).get(`${api}/${idOrSlug}`);
  return token ? req.set(bearer(token)) : req;
};

describe('creating events', () => {
  test('a customer cannot create events', async () => {
    const res = await request(app)
      .post(api)
      .set(bearer(customer.session.accessToken))
      .send({ title: 'My show', categoryIds: [category.id] });
    expect(res.status).toBe(403);
  });

  test('an organizer creates a DRAFT; the slug is derived from the Vietnamese title', async () => {
    const event = await createEvent(app, organizerA.token, {
      title: 'Đêm nhạc Sơn Tùng M-TP',
      categoryIds: [category.id],
    });
    expect(event).toMatchObject({ status: 'DRAFT', schedules: [], organizer: { id: organizerA.organizerId } });
    expect(event.slug).toMatch(/^dem-nhac-son-tung-m-tp-[a-f0-9]{6}$/);
    expect(event.categories.map((c) => c.id)).toEqual([category.id]);
  });

  test('unknown categories and non-http image URLs are rejected', async () => {
    const unknown = await request(app)
      .post(api)
      .set(bearer(organizerA.token))
      .send({ title: 'Show', categoryIds: ['00000000-0000-4000-8000-000000000000'] });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('CATEGORY_NOT_FOUND');

    const xss = await request(app)
      .post(api)
      .set(bearer(organizerA.token))
      .send({ title: 'Show', categoryIds: [category.id], bannerUrl: 'javascript:alert(1)' });
    expect(xss.status).toBe(400);
  });
});

describe('ownership and visibility', () => {
  test('a DRAFT is visible only to its owner and admins; others get 404', async () => {
    const event = await createEvent(app, organizerA.token, { categoryIds: [category.id] });

    await getEvent(event.id).expect(404);
    await getEvent(event.id, organizerB.token).expect(404);
    await getEvent(event.id, organizerA.token).expect(200);
    await getEvent(event.slug, admin.token).expect(200);

    const hijack = await request(app).patch(`${api}/${event.id}`).set(bearer(organizerB.token)).send({ title: 'Mine now' });
    expect(hijack.status).toBe(404);
  });
});

describe('schedules', () => {
  test('the database rejects overlapping schedules at the same venue, even across events', async () => {
    const venue = await createVenue(app, admin.token);
    const first = await createEvent(app, organizerA.token, { categoryIds: [category.id] });
    const second = await createEvent(app, organizerB.token, { categoryIds: [category.id] });

    await addSchedule(app, organizerA.token, first.id, { venueId: venue.id, startAt: at(40, 18), endAt: at(40, 21) }).expect(201);

    const overlap = await addSchedule(app, organizerB.token, second.id, {
      venueId: venue.id,
      startAt: at(40, 20),
      endAt: at(40, 22),
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('SCHEDULE_CONFLICT');

    // Back-to-back is fine: the range end is exclusive.
    await addSchedule(app, organizerB.token, second.id, { venueId: venue.id, startAt: at(40, 21), endAt: at(40, 23) }).expect(201);
  });

  test('two organizers booking the same slot at the same instant: exactly one wins', async () => {
    const venue = await createVenue(app, admin.token);
    const first = await createEvent(app, organizerA.token, { categoryIds: [category.id] });
    const second = await createEvent(app, organizerB.token, { categoryIds: [category.id] });
    const slot = { venueId: venue.id, startAt: at(41, 18), endAt: at(41, 21) };

    const results = await Promise.all([
      addSchedule(app, organizerA.token, first.id, slot),
      addSchedule(app, organizerB.token, second.id, slot),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  test('times are validated with field-level messages', async () => {
    const venue = await createVenue(app, admin.token);
    const event = await createEvent(app, organizerA.token, { categoryIds: [category.id] });

    const past = await addSchedule(app, organizerA.token, event.id, { venueId: venue.id, startAt: at(-1), endAt: at(-1, 14) });
    expect(past.status).toBe(400);
    expect(past.body.error.details).toContainEqual({ field: 'body.startAt', message: 'must be in the future' });

    const backwards = await addSchedule(app, organizerA.token, event.id, { venueId: venue.id, startAt: at(5, 14), endAt: at(5, 12) });
    expect(backwards.body.error.details[0].field).toBe('body.endAt');
  });

  test('an inactive venue cannot be booked', async () => {
    const venue = await createVenue(app, admin.token);
    await request(app).patch(`/api/v1/venues/${venue.id}`).set(bearer(admin.token)).send({ status: 'INACTIVE' }).expect(200);
    const event = await createEvent(app, organizerA.token, { categoryIds: [category.id] });

    const res = await addSchedule(app, organizerA.token, event.id, { venueId: venue.id, startAt: at(6), endAt: at(6, 14) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VENUE_NOT_AVAILABLE');
  });
});

describe('event status machine', () => {
  test('full lifecycle: submit → reject (with reason) → resubmit → approve', async () => {
    const venue = await createVenue(app, admin.token);
    const event = await createEvent(app, organizerA.token, { categoryIds: [category.id] });

    const empty = await changeStatus(app, organizerA.token, event.id, 'PENDING_APPROVAL');
    expect(empty.body.error.code).toBe('EVENT_HAS_NO_SCHEDULES');

    const schedule = await addSchedule(app, organizerA.token, event.id, { venueId: venue.id, startAt: at(20), endAt: at(20, 14) }).expect(201);

    // A schedule without ticket types cannot be sold, so it cannot be submitted.
    const noTickets = await changeStatus(app, organizerA.token, event.id, 'PENDING_APPROVAL');
    expect(noTickets.body.error.code).toBe('TICKET_TYPES_REQUIRED');

    await addGaTicketType(app, organizerA.token, schedule.body.data.schedule.id).expect(201);
    await changeStatus(app, organizerA.token, event.id, 'PENDING_APPROVAL').expect(200);

    // Frozen while under review; the owner cannot approve their own event.
    const edit = await request(app).patch(`${api}/${event.id}`).set(bearer(organizerA.token)).send({ title: 'Changed' });
    expect(edit.body.error.code).toBe('EVENT_NOT_EDITABLE');
    expect((await changeStatus(app, organizerA.token, event.id, 'PUBLISHED')).status).toBe(403);

    expect((await changeStatus(app, admin.token, event.id, 'DRAFT')).body.error.code).toBe('REASON_REQUIRED');
    await changeStatus(app, admin.token, event.id, 'DRAFT', 'Banner is missing').expect(200);

    await changeStatus(app, organizerA.token, event.id, 'PENDING_APPROVAL').expect(200);
    const published = await changeStatus(app, admin.token, event.id, 'PUBLISHED').expect(200);
    expect(published.body.data.event.status).toBe('PUBLISHED');
    expect(published.body.data.event.publishedAt).not.toBeNull();

    const { rows } = await query(
      // created_at is the transaction time: actions of one transaction tie, so action breaks the tie.
      `SELECT action FROM audit_logs WHERE entity_type = 'event' AND entity_id = $1 ORDER BY created_at, action`,
      [event.id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'EVENT_SUBMITTED',
      'EVENT_REJECTED',
      'EVENT_SUBMITTED',
      'EVENT_APPROVED',
      'INVENTORY_GENERATED', // same transaction as the approval
    ]);
  });

  test('two admins approving at the same moment: one 200, one 409', async () => {
    const venue = await createVenue(app, admin.token);
    const event = await createEvent(app, organizerA.token, { categoryIds: [category.id] });
    const schedule = await addSchedule(app, organizerA.token, event.id, { venueId: venue.id, startAt: at(21), endAt: at(21, 14) }).expect(201);
    await addGaTicketType(app, organizerA.token, schedule.body.data.schedule.id).expect(201);
    await changeStatus(app, organizerA.token, event.id, 'PENDING_APPROVAL').expect(200);

    const results = await Promise.all([
      changeStatus(app, admin.token, event.id, 'PUBLISHED'),
      changeStatus(app, admin.token, event.id, 'PUBLISHED'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  test('after publishing: only description/images change; schedules can only be cancelled', async () => {
    const venue = await createVenue(app, admin.token);
    const event = await createPublishedEvent(app, {
      organizer: organizerA, adminToken: admin.token, categoryIds: [category.id], venueId: venue.id,
    });

    const title = await request(app).patch(`${api}/${event.id}`).set(bearer(organizerA.token)).send({ title: 'New title' });
    expect(title.body.error.code).toBe('EVENT_NOT_EDITABLE');
    expect(title.body.error.details).toEqual([{ field: 'body.title', message: 'cannot change after publishing' }]);
    await request(app).patch(`${api}/${event.id}`).set(bearer(organizerA.token)).send({ description: 'Updated' }).expect(200);

    const scheduleId = event.schedules[0].id;
    const move = await request(app).patch(`/api/v1/schedules/${scheduleId}`).set(bearer(organizerA.token)).send({ startAt: at(31).toISOString() });
    expect(move.body.error.code).toBe('EVENT_NOT_EDITABLE');
    const cancelled = await request(app)
      .patch(`/api/v1/schedules/${scheduleId}`)
      .set(bearer(organizerA.token))
      .send({ status: 'CANCELLED' })
      .expect(200);
    expect(cancelled.body.data.schedule.status).toBe('CANCELLED');
  });

  test('cancelling an event cancels its schedules and frees the venue slot', async () => {
    const venue = await createVenue(app, admin.token);
    const event = await createPublishedEvent(app, {
      organizer: organizerA, adminToken: admin.token, categoryIds: [category.id], venueId: venue.id, daysFromNow: 50,
    });

    expect((await changeStatus(app, organizerA.token, event.id, 'CANCELLED')).body.error.code).toBe('REASON_REQUIRED');
    const cancelled = await changeStatus(app, organizerA.token, event.id, 'CANCELLED', 'Artist is ill').expect(200);
    expect(cancelled.body.data.event.schedules.map((s) => s.status)).toEqual(['CANCELLED']);

    const other = await createEvent(app, organizerB.token, { categoryIds: [category.id] });
    await addSchedule(app, organizerB.token, other.id, { venueId: venue.id, startAt: at(50, 12), endAt: at(50, 14) }).expect(201);

    const reopen = await changeStatus(app, admin.token, event.id, 'PENDING_APPROVAL');
    expect(reopen.status).toBe(409);
    expect(reopen.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  test('only DRAFT events can be deleted; a used category cannot be deleted', async () => {
    const venue = await createVenue(app, admin.token);
    const usedCategory = await createCategory(app, admin.token);
    const draft = await createEvent(app, organizerA.token, { categoryIds: [usedCategory.id] });
    await addSchedule(app, organizerA.token, draft.id, { venueId: venue.id, startAt: at(9), endAt: at(9, 14) }).expect(201);

    const blocked = await request(app).delete(`/api/v1/categories/${usedCategory.id}`).set(bearer(admin.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_IN_USE');

    await request(app).delete(`${api}/${draft.id}`).set(bearer(organizerA.token)).expect(204);
    await getEvent(draft.id, organizerA.token).expect(404);
    await request(app).delete(`/api/v1/categories/${usedCategory.id}`).set(bearer(admin.token)).expect(204);

    const published = await createPublishedEvent(app, {
      organizer: organizerA, adminToken: admin.token, categoryIds: [category.id], venueId: venue.id, daysFromNow: 12,
    });
    const res = await request(app).delete(`${api}/${published.id}`).set(bearer(organizerA.token));
    expect(res.body.error.code).toBe('EVENT_NOT_EDITABLE');
  });
});

describe('GET /events (list, search, filters)', () => {
  // A category of its own per test keeps results independent from other tests' events.
  async function publishedSet() {
    const listCategory = await createCategory(app, admin.token);
    const hanoi = await createVenue(app, admin.token, { city: 'Hà Nội' });
    const saigon = await createVenue(app, admin.token, { city: 'Hồ Chí Minh' });
    const tag = unique();
    const options = { organizer: organizerA, adminToken: admin.token, categoryIds: [listCategory.id] };

    const later = await createPublishedEvent(app, { ...options, venueId: saigon.id, daysFromNow: 25, title: `Sơn Tùng live ${tag}` });
    const sooner = await createPublishedEvent(app, { ...options, venueId: hanoi.id, daysFromNow: 15, title: `Mỹ Tâm concert ${tag}` });
    const draft = await createEvent(app, organizerA.token, { categoryIds: [listCategory.id], title: `Draft show ${tag}` });
    return { listCategory, tag, later, sooner, draft };
  }

  const list = (params, token) => {
    const req = request(app).get(api).query(params);
    return token ? req.set(bearer(token)) : req;
  };

  test('public list: published only, soonest first, with pagination meta', async () => {
    const { listCategory, later, sooner } = await publishedSet();
    const res = await list({ categoryId: listCategory.id }).expect(200);

    expect(res.body.data.events.map((e) => e.id)).toEqual([sooner.id, later.id]);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    expect(res.body.data.events[0]).toMatchObject({ cities: ['Hà Nội'], categories: [{ id: listCategory.id }] });

    const page2 = await list({ categoryId: listCategory.id, pageSize: 1, page: 2 }).expect(200);
    expect(page2.body.data.events.map((e) => e.id)).toEqual([later.id]);
  });

  test('search ignores accents; city filter ignores accents; LIKE wildcards are literal', async () => {
    const { listCategory, tag, later, sooner } = await publishedSet();

    const byTitle = await list({ q: `son tung live ${tag}` });
    expect(byTitle.body.data.events.map((e) => e.id)).toEqual([later.id]);

    const byCity = await list({ categoryId: listCategory.id, city: 'ha noi' });
    expect(byCity.body.data.events.map((e) => e.id)).toEqual([sooner.id]);

    const wildcard = await list({ categoryId: listCategory.id, q: '%' });
    expect(wildcard.body.data.events).toHaveLength(0);
  });

  test('mine=true shows the organizer their drafts; status filters are for admins', async () => {
    const { listCategory, draft } = await publishedSet();

    const mine = await list({ mine: 'true', categoryId: listCategory.id, status: 'DRAFT' }, organizerA.token).expect(200);
    expect(mine.body.data.events.map((e) => e.id)).toEqual([draft.id]);

    const notOrganizer = await list({ mine: 'true' }, customer.session.accessToken);
    expect(notOrganizer.body.error.code).toBe('ORGANIZER_PROFILE_REQUIRED');

    await list({ status: 'PENDING_APPROVAL' }, customer.session.accessToken).expect(403);
    await list({ status: 'PENDING_APPROVAL' }, admin.token).expect(200);
  });

  test('sort must be one of the whitelisted keys', async () => {
    const res = await list({ sort: 'title; DROP TABLE events' });
    expect(res.status).toBe(400);
  });
});

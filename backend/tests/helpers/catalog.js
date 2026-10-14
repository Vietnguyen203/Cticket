const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { seedAdmin } = require('../../src/scripts/seedAdmin');
const { uniqueEmail, createLoggedInUser, loginWithTwoFactor, ADMIN_TOTP_SECRET } = require('./auth');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ADMIN_PASSWORD = 'AdminPass123';

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const unique = () => randomUUID().slice(0, 8);

/** A fixed hour, N days from today (UTC). Deterministic, so tests can build overlaps exactly. */
function at(daysFromNow, hour = 12) {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  return new Date(midnight.getTime() + daysFromNow * DAY_MS + hour * HOUR_MS);
}

/** A new admin, signed in with two-factor (required for admins since Phase 15). */
async function createAdmin(app) {
  const email = uniqueEmail();
  await seedAdmin({ email, password: ADMIN_PASSWORD, totpSecret: ADMIN_TOTP_SECRET });
  const res = await loginWithTwoFactor(app, email, ADMIN_PASSWORD);
  return { email, password: ADMIN_PASSWORD, token: res.body.data.accessToken };
}

/**
 * A verified user who applied as organizer, was approved by the admin, and
 * refreshed their token so it carries the ORGANIZER role.
 */
async function createOrganizer(app, mailbox, adminToken) {
  const user = await createLoggedInUser(app, mailbox);
  const applied = await request(app)
    .post('/api/v1/organizers')
    .set(bearer(user.session.accessToken))
    .send({ organizationName: `Organizer ${unique()}` })
    .expect(201);
  const organizerId = applied.body.data.organizer.id;

  await request(app)
    .patch(`/api/v1/organizers/${organizerId}/status`)
    .set(bearer(adminToken))
    .send({ status: 'ACTIVE' })
    .expect(200);
  const refreshed = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: user.session.refreshToken })
    .expect(200);

  return { ...user, organizerId, token: refreshed.body.data.accessToken };
}

async function createCategory(app, adminToken, name = `Category ${unique()}`) {
  const res = await request(app).post('/api/v1/categories').set(bearer(adminToken)).send({ name }).expect(201);
  return res.body.data.category;
}

async function createVenue(app, adminToken, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/venues')
    .set(bearer(adminToken))
    .send({ name: `Venue ${unique()}`, addressLine: '1 Le Loi', city: 'Hồ Chí Minh', capacity: 500, ...overrides })
    .expect(201);
  return res.body.data.venue;
}

async function createEvent(app, organizerToken, { categoryIds, title = `Concert ${unique()}`, ...rest }) {
  const res = await request(app)
    .post('/api/v1/events')
    .set(bearer(organizerToken))
    .send({ title, categoryIds, ...rest })
    .expect(201);
  return res.body.data.event;
}

function addSchedule(app, organizerToken, eventId, { venueId, startAt, endAt }) {
  return request(app)
    .post(`/api/v1/events/${eventId}/schedules`)
    .set(bearer(organizerToken))
    .send({ venueId, startAt: startAt.toISOString(), endAt: endAt.toISOString() });
}

function changeStatus(app, token, eventId, status, reason) {
  return request(app).patch(`/api/v1/events/${eventId}/status`).set(bearer(token)).send({ status, reason });
}

function addTicketType(app, token, scheduleId, body) {
  return request(app).post(`/api/v1/schedules/${scheduleId}/ticket-types`).set(bearer(token)).send(body);
}

/** The simplest sellable configuration: one general admission ticket type. */
function addGaTicketType(app, token, scheduleId, { code = 'GA', capacity = 100, price = 500_000 } = {}) {
  return addTicketType(app, token, scheduleId, {
    code,
    name: `Ticket ${code}`,
    price,
    inventoryMode: 'GENERAL_ADMISSION',
    capacity,
  });
}

/** DRAFT with one schedule (+ one GA ticket type) → submitted → approved. */
async function createPublishedEvent(app, { organizer, adminToken, categoryIds, venueId, daysFromNow = 30, title }) {
  const event = await createEvent(app, organizer.token, { categoryIds, title });
  const schedule = await addSchedule(app, organizer.token, event.id, {
    venueId,
    startAt: at(daysFromNow, 12),
    endAt: at(daysFromNow, 14),
  }).expect(201);
  await addGaTicketType(app, organizer.token, schedule.body.data.schedule.id).expect(201);
  await changeStatus(app, organizer.token, event.id, 'PENDING_APPROVAL').expect(200);
  const published = await changeStatus(app, adminToken, event.id, 'PUBLISHED').expect(200);
  return published.body.data.event;
}

module.exports = {
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
  addTicketType,
  addGaTicketType,
  createPublishedEvent,
};

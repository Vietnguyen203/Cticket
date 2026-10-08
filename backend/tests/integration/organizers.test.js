const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { useFakeMailbox, createLoggedInUser } = require('../helpers/auth');
const { bearer, unique, createAdmin } = require('../helpers/catalog');

const app = createApp();
const mailbox = useFakeMailbox();
const api = '/api/v1/organizers';
let admin;

beforeAll(async () => {
  admin = await createAdmin(app);
});
afterAll(() => closePool());

async function applyAsOrganizer() {
  const user = await createLoggedInUser(app, mailbox);
  const res = await request(app)
    .post(api)
    .set(bearer(user.session.accessToken))
    .send({ organizationName: `Live Nation ${unique()}`, taxCode: null })
    .expect(201);
  return { user, organizer: res.body.data.organizer };
}

const setStatus = (id, body, token = admin.token) =>
  request(app).patch(`${api}/${id}/status`).set(bearer(token)).send(body);

test('a user applies once; the profile starts PENDING', async () => {
  const { user, organizer } = await applyAsOrganizer();
  expect(organizer.status).toBe('PENDING');

  const mine = await request(app).get(`${api}/me`).set(bearer(user.session.accessToken)).expect(200);
  expect(mine.body.data.organizer.id).toBe(organizer.id);

  const again = await request(app)
    .post(api)
    .set(bearer(user.session.accessToken))
    .send({ organizationName: 'Second try' });
  expect(again.status).toBe(409);
  expect(again.body.error.code).toBe('ORGANIZER_ALREADY_EXISTS');
});

test('approval grants the ORGANIZER role (visible after token refresh) and is audited', async () => {
  const { user, organizer } = await applyAsOrganizer();

  await setStatus(organizer.id, { status: 'ACTIVE' }, user.session.accessToken).expect(403); // not an admin
  const approved = await setStatus(organizer.id, { status: 'ACTIVE' }).expect(200);
  expect(approved.body.data.organizer.status).toBe('ACTIVE');

  // The old access token still says CUSTOMER; refresh re-reads roles from the database.
  expect(jwt.decode(user.session.accessToken).roles).toEqual(['CUSTOMER']);
  const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.session.refreshToken });
  expect(jwt.decode(refreshed.body.data.accessToken).roles).toEqual(['CUSTOMER', 'ORGANIZER']);

  const { rows } = await query(
    `SELECT action, old_value, new_value FROM audit_logs WHERE entity_type = 'organizer' AND entity_id = $1`,
    [organizer.id],
  );
  expect(rows).toEqual([
    { action: 'ORGANIZER_APPROVED', old_value: { status: 'PENDING' }, new_value: { status: 'ACTIVE', reason: null } },
  ]);
});

test('rejection needs a reason; a rejected applicant can apply again', async () => {
  const { user, organizer } = await applyAsOrganizer();

  const noReason = await setStatus(organizer.id, { status: 'REJECTED' });
  expect(noReason.body.error.code).toBe('REASON_REQUIRED');
  await setStatus(organizer.id, { status: 'REJECTED', reason: 'Missing tax documents' }).expect(200);

  const reapplied = await request(app)
    .post(api)
    .set(bearer(user.session.accessToken))
    .send({ organizationName: 'Fixed details', taxCode: '0312345678' })
    .expect(201);
  expect(reapplied.body.data.organizer).toMatchObject({ id: organizer.id, status: 'PENDING', taxCode: '0312345678' });
});

test('transitions outside the state machine are refused', async () => {
  const { organizer } = await applyAsOrganizer();
  const res = await setStatus(organizer.id, { status: 'SUSPENDED', reason: 'Not yet active' });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
});

test('two admins approving at the same moment: exactly one succeeds', async () => {
  const { organizer } = await applyAsOrganizer();
  const [first, second] = await Promise.all([
    setStatus(organizer.id, { status: 'ACTIVE' }),
    setStatus(organizer.id, { status: 'ACTIVE' }),
  ]);

  expect([first.status, second.status].sort()).toEqual([200, 409]);
  const { rows } = await query(`SELECT count(*) AS count FROM audit_logs WHERE entity_id = $1`, [organizer.id]);
  expect(rows[0].count).toBe(1); // the losing request wrote nothing
});

test('only admins can list applications', async () => {
  const { user } = await applyAsOrganizer();
  await request(app).get(api).set(bearer(user.session.accessToken)).expect(403);

  const res = await request(app).get(api).set(bearer(admin.token)).query({ status: 'PENDING' }).expect(200);
  expect(res.body.data.organizers.every((o) => o.status === 'PENDING')).toBe(true);
  expect(res.body.data.organizers[0]).toHaveProperty('userEmail');
});

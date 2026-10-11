const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { redis } = require('../../src/redis/client');
const { setRateLimitEnabled } = require('../../src/middleware/rateLimit');
const {
  useFakeMailbox,
  registerUser,
  verifyEmail,
  login,
  createVerifiedUser,
  createLoggedInUser,
} = require('../helpers/auth');

const app = createApp();
// Each test pretends to come from its own client IP (X-Forwarded-For), so
// rate limit counters never leak from one test into another.
app.set('trust proxy', true);
const mailbox = useFakeMailbox();

afterAll(() => closePool());
// Restore only the Redis spies of these tests: jest.restoreAllMocks() would
// also remove the fake mailbox installed by useFakeMailbox().
const redisSpies = [];
const breakRedis = (command) => {
  redisSpies.push(jest.spyOn(redis, command).mockRejectedValue(new Error('Connection is closed.')));
};
const repairRedis = () => {
  redisSpies.splice(0).forEach((spy) => spy.mockRestore());
};
afterEach(() => {
  repairRedis();
  setRateLimitEnabled(false);
});

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const newIp = () => `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;

describe('rate limits (Redis counters)', () => {
  beforeEach(() => setRateLimitEnabled(true));

  test('login: 5 attempts per minute per IP, then 429 with Retry-After', async () => {
    const ip = newIp();
    const attempt = () =>
      request(app).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: 'nobody@example.com', password: 'Wrong123' });

    for (let i = 0; i < 5; i += 1) {
      const res = await attempt();
      expect(res.status).toBe(401);
      expect(res.headers['ratelimit-remaining']).toBe(String(4 - i));
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);

    // Another client (another IP) is not affected.
    const other = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', newIp())
      .send({ email: 'nobody@example.com', password: 'Wrong123' });
    expect(other.status).toBe(401);
  });

  test('booking: 10 requests per minute per user', async () => {
    const user = await createLoggedInUser(app, mailbox);
    const book = () =>
      request(app)
        .post(`/api/v1/schedules/${randomUUID()}/orders`)
        .set('X-Forwarded-For', newIp()) // different IPs: the limit follows the user, not the IP
        .set(bearer(user.session.accessToken))
        .send({ items: [{ ticketTypeId: randomUUID(), quantity: 1 }] });

    for (let i = 0; i < 10; i += 1) {
      expect((await book()).status).toBe(404); // the schedule does not exist, but the request counts
    }
    expect((await book()).status).toBe(429);
  });

  test('if Redis is down, requests are let through', async () => {
    breakRedis('rateLimitHit');
    const ip = newIp();
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: 'x@example.com', password: 'Wrong123' });
      expect(res.status).toBe(401);
    }
  });
});

describe('logout and password reset end access tokens immediately (denylist)', () => {
  test('after logout, the access token is refused even though it has not expired', async () => {
    const { session } = await createLoggedInUser(app, mailbox);
    await request(app).get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(200);

    await request(app)
      .post('/api/v1/auth/logout')
      .set(bearer(session.accessToken))
      .send({ refreshToken: session.refreshToken })
      .expect(204);

    const res = await request(app).get('/api/v1/auth/me').set(bearer(session.accessToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REVOKED');
  });

  test('logout only ends the session it was called from', async () => {
    const credentials = await createVerifiedUser(app, mailbox);
    const phone = (await login(app, credentials.email, credentials.password).expect(200)).body.data;
    const laptop = (await login(app, credentials.email, credentials.password).expect(200)).body.data;

    await request(app).post('/api/v1/auth/logout').set(bearer(phone.accessToken)).send({ refreshToken: phone.refreshToken }).expect(204);
    await request(app).get('/api/v1/auth/me').set(bearer(laptop.accessToken)).expect(200);
  });

  test('a password reset ends every access token of the user; a new login works', async () => {
    const credentials = await createVerifiedUser(app, mailbox);
    const before = (await login(app, credentials.email, credentials.password).expect(200)).body.data;

    // Tokens carry iat in whole seconds; make sure the reset happens in a later second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await request(app).post('/api/v1/auth/otp').send({ email: credentials.email, purpose: 'PASSWORD_RESET' }).expect(202);
    await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ email: credentials.email, purpose: 'PASSWORD_RESET', otp: mailbox.latestOtp(credentials.email), newPassword: 'NewSecret456' })
      .expect(200);

    expect((await request(app).get('/api/v1/auth/me').set(bearer(before.accessToken))).body.error.code).toBe('TOKEN_REVOKED');
    const after = (await login(app, credentials.email, 'NewSecret456').expect(200)).body.data;
    await request(app).get('/api/v1/auth/me').set(bearer(after.accessToken)).expect(200);
  });

  test('if Redis is down the denylist check is skipped (the token is still verified)', async () => {
    const { session } = await createLoggedInUser(app, mailbox);
    breakRedis('mget');
    await request(app).get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(200);
    await request(app).get('/api/v1/auth/me').set(bearer('not-a-jwt')).expect(401);
  });
});

describe('OTP codes in Redis', () => {
  test('two verifications with the right code at the same time: exactly one succeeds', async () => {
    const { email } = await registerUser(app);
    const otp = mailbox.latestOtp(email);
    const statuses = (await Promise.all([verifyEmail(app, email, otp), verifyEmail(app, email, otp)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([200, 400]);
  });

  test('if Redis is down: registration still works, sending a code answers 503', async () => {
    breakRedis('otpIssue');
    const { res, email } = await registerUser(app);
    expect(res.status).toBe(201); // the account is saved; "resend code" fixes it later
    expect(mailbox.count(email)).toBe(0);

    const resend = await request(app).post('/api/v1/auth/otp').send({ email, purpose: 'EMAIL_VERIFICATION' });
    expect(resend.status).toBe(503);
    expect(resend.body.error.code).toBe('SERVICE_UNAVAILABLE');

    repairRedis();
    await request(app).post('/api/v1/auth/otp').send({ email, purpose: 'EMAIL_VERIFICATION' }).expect(202);
    await verifyEmail(app, email, mailbox.latestOtp(email)).expect(200);
  });
});

describe('profile: GET / PATCH /users/me', () => {
  test('a user edits their own name and phone; email and status are not editable here', async () => {
    const { session, email } = await createLoggedInUser(app, mailbox);
    const me = await request(app).get('/api/v1/users/me').set(bearer(session.accessToken)).expect(200);
    expect(me.body.data.user).toMatchObject({ email, roles: ['CUSTOMER'] });

    const phone = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const updated = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(session.accessToken))
      .send({ firstName: 'Minh', lastName: 'Trần', phone })
      .expect(200);
    expect(updated.body.data.user).toMatchObject({ firstName: 'Minh', lastName: 'Trần', phone, email });

    const onlyForbidden = await request(app).patch('/api/v1/users/me').set(bearer(session.accessToken)).send({ email: 'x@example.com', status: 'ACTIVE' });
    expect(onlyForbidden.status).toBe(400); // unknown fields are dropped, leaving nothing to change

    const { rows } = await query(`SELECT email FROM users WHERE email = $1`, [email]);
    expect(rows).toHaveLength(1);
  });

  test('a phone number already used by someone else → 409 PHONE_TAKEN', async () => {
    const first = await createLoggedInUser(app, mailbox);
    const second = await createLoggedInUser(app, mailbox);
    const phone = `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    await request(app).patch('/api/v1/users/me').set(bearer(first.session.accessToken)).send({ phone }).expect(200);

    const res = await request(app).patch('/api/v1/users/me').set(bearer(second.session.accessToken)).send({ phone });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_TAKEN');
  });
});

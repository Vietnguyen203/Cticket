const request = require('supertest');
const jwt = require('jsonwebtoken');
const env = require('../../src/config/env');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { redis } = require('../../src/redis/client');
const { otpKeys } = require('../../src/modules/auth/otp.service');
const {
  DEFAULT_PASSWORD,
  useFakeMailbox,
  uniqueEmail,
  registerUser,
  verifyEmail,
  login,
  createVerifiedUser,
  createLoggedInUser,
} = require('../helpers/auth');

const app = createApp();
const mailbox = useFakeMailbox();

afterAll(() => closePool());

const api = (path) => `/api/v1/auth${path}`;
const wrongOtpFor = (otp) => (otp === '000000' ? '111111' : '000000');

async function findUser(email) {
  const { rows } = await query(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0];
}

/** The pending code of a user in Redis: { hash, attempts } or null once it is used up / revoked. */
async function findActiveOtp(email, purpose) {
  const { code } = otpKeys((await findUser(email)).id, purpose);
  const stored = await redis.hgetall(code);
  return Object.keys(stored).length > 0 ? { ...stored, attempts: Number(stored.attempts) } : null;
}

/** Pretend the last code was issued long ago, to step past the resend cooldown. */
async function skipOtpCooldown(email) {
  const user = await findUser(email);
  await redis.del(otpKeys(user.id, 'EMAIL_VERIFICATION').cooldown, otpKeys(user.id, 'PASSWORD_RESET').cooldown);
}

describe('POST /auth/register', () => {
  test('creates a PENDING_VERIFICATION customer and emails a 6-digit code', async () => {
    const { res, email, password } = await registerUser(app);

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email, status: 'PENDING_VERIFICATION', roles: ['CUSTOMER'] });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    expect(mailbox.latestOtp(email)).toMatch(/^\d{6}$/);

    const stored = await findUser(email);
    expect(stored.password_hash).not.toBe(password); // bcrypt hash, never the plain password
    expect(stored.password_hash).toMatch(/^\$2[aby]\$/);
  });

  test('email is unique case-insensitively → 409 EMAIL_TAKEN', async () => {
    const { email } = await registerUser(app);
    const { res } = await registerUser(app, { email: email.toUpperCase() });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('concurrent registrations with the same email: exactly one succeeds', async () => {
    const email = uniqueEmail();
    const responses = await Promise.all(Array.from({ length: 5 }, () => registerUser(app, { email })));
    const statuses = responses.map(({ res }) => res.status).sort();

    expect(statuses).toEqual([201, 409, 409, 409, 409]);
  });

  test('validates input and never echoes the password back', async () => {
    const weak = await registerUser(app, { password: 'short' });
    expect(weak.res.status).toBe(400);
    expect(weak.res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'body.password' })]),
    );
    expect(JSON.stringify(weak.res.body)).not.toContain('short');

    // 30 × "ệ" = 90 bytes in UTF-8: only 32 characters, but over bcrypt's 72-byte limit.
    const tooLong = await registerUser(app, { password: `${'ệ'.repeat(30)}a1` });
    expect(tooLong.res.status).toBe(400);
    expect(tooLong.res.body.error.details[0].message).toMatch(/72 bytes/);

    const badEmail = await registerUser(app, { email: 'not-an-email' });
    expect(badEmail.res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('email verification with a 6-digit OTP', () => {
  test('login is refused until the email is verified', async () => {
    const { email } = await registerUser(app);

    const before = await login(app, email);
    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    await verifyEmail(app, email, mailbox.latestOtp(email)).expect(200);
    await login(app, email).expect(200);
    expect((await findUser(email)).status).toBe('ACTIVE');
  });

  test('a wrong code is rejected AND the failed attempt is persisted', async () => {
    const { email } = await registerUser(app);
    const res = await verifyEmail(app, email, wrongOtpFor(mailbox.latestOtp(email)));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OTP');
    // The request failed, yet the counter was committed (not rolled back).
    expect((await findActiveOtp(email, 'EMAIL_VERIFICATION')).attempts).toBe(1);
  });

  test('after 5 wrong guesses the code is revoked, even the right code stops working', async () => {
    const { email } = await registerUser(app);
    const otp = mailbox.latestOtp(email);

    for (let i = 0; i < 5; i += 1) {
      await verifyEmail(app, email, wrongOtpFor(otp)).expect(400);
    }
    await verifyEmail(app, email, otp).expect(400);
    expect(await findActiveOtp(email, 'EMAIL_VERIFICATION')).toBeNull(); // deleted at the 5th wrong guess
  });

  test('a code works only once', async () => {
    const { email } = await registerUser(app);
    const otp = mailbox.latestOtp(email);

    await verifyEmail(app, email, otp).expect(200);
    await verifyEmail(app, email, otp).expect(400);
  });

  test('an expired code is rejected', async () => {
    const { email } = await registerUser(app);
    // Redis drops the key when its 10-minute TTL ends; make that happen now.
    const { code } = otpKeys((await findUser(email)).id, 'EMAIL_VERIFICATION');
    await redis.pexpire(code, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await verifyEmail(app, email, mailbox.latestOtp(email)).expect(400);
  });

  test('resend: cooldown blocks spam; a new code replaces the old one', async () => {
    const { email } = await registerUser(app);
    const firstOtp = mailbox.latestOtp(email);
    const resend = () => request(app).post(api('/otp')).send({ email, purpose: 'EMAIL_VERIFICATION' });

    await resend().expect(202);
    expect(mailbox.count(email)).toBe(1); // still within the 60 s cooldown: nothing sent

    await skipOtpCooldown(email);
    await resend().expect(202);
    expect(mailbox.count(email)).toBe(2);

    const secondOtp = mailbox.latestOtp(email);
    if (secondOtp !== firstOtp) {
      await verifyEmail(app, email, firstOtp).expect(400); // old code revoked
    }
    await verifyEmail(app, email, secondOtp).expect(200);
  });

  test('requesting a code never reveals whether the email exists', async () => {
    const unknown = uniqueEmail();
    const res = await request(app).post(api('/otp')).send({ email: unknown, purpose: 'EMAIL_VERIFICATION' });

    expect(res.status).toBe(202);
    expect(mailbox.count(unknown)).toBe(0);
  });
});

describe('POST /auth/login and GET /auth/me', () => {
  test('wrong password and unknown email give the identical 401 response', async () => {
    const { email } = await createVerifiedUser(app, mailbox);

    const wrongPassword = await login(app, email, 'Wrong12345');
    const unknownEmail = await login(app, uniqueEmail(), 'Wrong12345');

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  test('returns an access token (JWT) and a refresh token; /me returns roles and permissions', async () => {
    const { email, session } = await createLoggedInUser(app, mailbox);

    expect(session).toMatchObject({ tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TTL_SECONDS });
    const claims = jwt.decode(session.accessToken);
    expect(claims).toMatchObject({ sub: session.user.id, roles: ['CUSTOMER'], typ: 'access' });

    const me = await request(app).get(api('/me')).set('Authorization', `Bearer ${session.accessToken}`).expect(200);
    expect(me.body.data.user).toMatchObject({ email, roles: ['CUSTOMER'] });
    expect(me.body.data.user.permissions).toContain('booking:create');
    expect(me.body.data.user.permissions).not.toContain('event:approve');
  });

  test('/me rejects missing, tampered, expired and non-access tokens', async () => {
    const { session } = await createLoggedInUser(app, mailbox);
    const getMe = (header) => request(app).get(api('/me')).set('Authorization', header);

    expect((await request(app).get(api('/me'))).body.error.code).toBe('UNAUTHENTICATED');
    expect((await getMe(`Bearer ${session.accessToken}x`)).status).toBe(401);
    expect((await getMe(`Bearer ${session.refreshToken}`)).status).toBe(401);

    const expired = jwt.sign({ typ: 'access', roles: ['CUSTOMER'] }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      subject: session.user.id,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      expiresIn: -10,
    });
    expect((await getMe(`Bearer ${expired}`)).body.error.code).toBe('TOKEN_EXPIRED');

    // Classic attack: an unsigned token declaring `alg: none` and claiming ADMIN.
    const encode = (part) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      typ: 'access', roles: ['ADMIN'], sub: session.user.id, iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE,
    })}.`;
    expect((await getMe(`Bearer ${unsigned}`)).status).toBe(401);
  });

  test('a suspended account cannot log in', async () => {
    const { email } = await createVerifiedUser(app, mailbox);
    await query(`UPDATE users SET status = 'SUSPENDED' WHERE email = $1`, [email]);

    const res = await login(app, email);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('refresh token rotation and logout', () => {
  const refresh = (refreshToken) => request(app).post(api('/refresh')).send({ refreshToken });

  test('each refresh returns a new pair; replaying an old token revokes the whole session', async () => {
    const { session } = await createLoggedInUser(app, mailbox);

    const first = await refresh(session.refreshToken).expect(200);
    const rotated = first.body.data.refreshToken;
    expect(rotated).not.toBe(session.refreshToken);

    // The original token is presented again → it was copied/stolen.
    const replay = await refresh(session.refreshToken);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate newer token died with the family.
    expect((await refresh(rotated)).status).toBe(401);
  });

  test('logout revokes the session; logout is idempotent', async () => {
    const { session } = await createLoggedInUser(app, mailbox);

    await request(app).post(api('/logout')).send({ refreshToken: session.refreshToken }).expect(204);
    const after = await refresh(session.refreshToken);
    expect(after.body.error.code).toBe('INVALID_REFRESH_TOKEN');

    await request(app).post(api('/logout')).send({ refreshToken: session.refreshToken }).expect(204);
    await request(app).post(api('/logout')).send({ refreshToken: 'x'.repeat(43) }).expect(204);
  });

  test('a suspended user cannot refresh', async () => {
    const { email, session } = await createLoggedInUser(app, mailbox);
    await query(`UPDATE users SET status = 'SUSPENDED' WHERE email = $1`, [email]);

    const res = await refresh(session.refreshToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('password reset with OTP', () => {
  const requestReset = (email) => request(app).post(api('/otp')).send({ email, purpose: 'PASSWORD_RESET' });
  const reset = (body) => request(app).post(api('/otp/verify')).send({ purpose: 'PASSWORD_RESET', ...body });

  test('resets the password and logs out every device', async () => {
    const { email, session } = await createLoggedInUser(app, mailbox);
    const newPassword = 'BrandNew456';

    await requestReset(email).expect(202);
    await reset({ email, otp: mailbox.latestOtp(email), newPassword }).expect(200);

    await login(app, email, DEFAULT_PASSWORD).expect(401);
    await login(app, email, newPassword).expect(200);
    const oldSession = await request(app).post(api('/refresh')).send({ refreshToken: session.refreshToken });
    expect(oldSession.status).toBe(401);
  });

  test('a reset requires the new password in the same request', async () => {
    const { email } = await createVerifiedUser(app, mailbox);
    await requestReset(email).expect(202);

    const res = await reset({ email, otp: mailbox.latestOtp(email) });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('body.newPassword');
  });

  test('an unverified account cannot receive a reset code', async () => {
    const { email } = await registerUser(app);
    mailbox.latestOtp(email); // the verification email
    await requestReset(email).expect(202);
    expect(mailbox.count(email)).toBe(1);
  });
});

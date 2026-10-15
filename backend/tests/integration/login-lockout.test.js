const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { seedAdmin } = require('../../src/scripts/seedAdmin');
const { emailHash } = require('../../src/modules/auth/login-guard');
const { totpAt } = require('../../src/utils/totp');
const { bearer, createAdmin } = require('../helpers/catalog');
const {
  useFakeMailbox,
  uniqueEmail,
  login,
  createVerifiedUser,
  ADMIN_TOTP_SECRET,
  DEFAULT_PASSWORD,
} = require('../helpers/auth');

/** Phase 18.1: a pause after repeated wrong passwords. See docs/phase-18-customer-features-design.md, section 2. */
const app = createApp();
const mailbox = useFakeMailbox();

afterAll(() => closePool());

const LOCK_SUBJECT = 'Đăng nhập tạm khóa sau nhiều lần sai mật khẩu';
const attemptRow = async (email) =>
  (await query(`SELECT failures, lock_level, locked_until FROM login_attempts WHERE email_hash = $1`, [emailHash(email)])).rows[0];

async function failTimes(email, times) {
  const responses = [];
  for (let i = 0; i < times; i += 1) responses.push(await login(app, email, 'Wrong-password-1'));
  return responses;
}

/** As if the lock had run out (instead of waiting 15 minutes). */
const expireLock = (email) =>
  query(`UPDATE login_attempts SET locked_until = now() - interval '1 second' WHERE email_hash = $1`, [emailHash(email)]);

describe('locking an email after wrong passwords', () => {
  test('the 5th wrong password locks for 15 minutes; then even the right one is refused; the owner is told once', async () => {
    const { email, password } = await createVerifiedUser(app, mailbox);
    const responses = await failTimes(email, 5);
    expect(responses.slice(0, 4).map((r) => r.body.error.code)).toEqual(Array(4).fill('INVALID_CREDENTIALS'));
    expect(responses[4].status).toBe(429);
    expect(responses[4].body.error).toMatchObject({ code: 'LOGIN_LOCKED', details: { retryAfterSeconds: expect.any(Number) } });
    expect(responses[4].body.error.details.retryAfterSeconds).toBeGreaterThan(890);

    const right = await login(app, email, password).expect(429);
    expect(right.body.error.code).toBe('LOGIN_LOCKED');
    expect(await attemptRow(email)).toMatchObject({ failures: 5, lock_level: 1 }); // a locked attempt is not counted
    expect(mailbox.subjects(email)).toEqual([expect.stringContaining('xác thực'), LOCK_SUBJECT]);
    expect(mailbox.latestText(email)).toContain('15 phút');

    // Each further lock of the streak lasts twice as long; only the first one is emailed.
    await expireLock(email);
    const again = await failTimes(email, 5);
    expect(again[4].body.error.details.retryAfterSeconds).toBeGreaterThan(1790);
    expect(mailbox.subjects(email).filter((s) => s === LOCK_SUBJECT)).toHaveLength(1);
  });

  test('an email without an account is locked the same way (nothing tells which emails exist)', async () => {
    const email = uniqueEmail();
    const responses = await failTimes(email, 6);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 429, 429]);
    expect(responses[5].body.error.code).toBe('LOGIN_LOCKED');
  });

  test('a successful sign-in ends the streak; a day without failures starts it over', async () => {
    const { email, password } = await createVerifiedUser(app, mailbox);
    await failTimes(email, 4);
    await login(app, email, password).expect(200);
    expect(await attemptRow(email)).toBeUndefined();

    await failTimes(email, 4);
    await query(`UPDATE login_attempts SET last_failure_at = now() - interval '25 hours' WHERE email_hash = $1`, [emailHash(email)]);
    const [fifth] = await failTimes(email, 1);
    expect(fifth.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await attemptRow(email)).toMatchObject({ failures: 1, lock_level: 0 });
  });

  test('failures at the same time are all counted', async () => {
    const email = uniqueEmail();
    await Promise.all(Array.from({ length: 4 }, () => login(app, email, 'Wrong-password-1')));
    expect(await attemptRow(email)).toMatchObject({ failures: 4, lock_level: 0 });
    const [fifth] = await failTimes(email, 1);
    expect(fifth.body.error.code).toBe('LOGIN_LOCKED');
  });
});

describe('ending a lock early', () => {
  test('resetting the password', async () => {
    const { email } = await createVerifiedUser(app, mailbox);
    await failTimes(email, 5);
    await request(app).post('/api/v1/auth/otp').send({ email, purpose: 'PASSWORD_RESET' }).expect(202);
    await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ email, purpose: 'PASSWORD_RESET', otp: mailbox.latestOtp(email), newPassword: 'New-password-2' })
      .expect(200);
    await login(app, email, 'New-password-2').expect(200);
  });

  test('an admin: the users list shows the lock, "unlock" ends it, audited', async () => {
    const admin = await createAdmin(app);
    const { email, password } = await createVerifiedUser(app, mailbox);
    await failTimes(email, 5);

    const list = await request(app).get('/api/v1/admin/users').query({ q: email }).set(bearer(admin.token)).expect(200);
    const [user] = list.body.data.users;
    expect(new Date(user.loginLockedUntil).getTime()).toBeGreaterThan(Date.now());

    await request(app).post(`/api/v1/admin/users/${user.id}/login-unlock`).set(bearer(admin.token)).expect(200);
    await login(app, email, password).expect(200);
    const { rows } = await query(`SELECT action FROM audit_logs WHERE entity_id = $1`, [user.id]);
    expect(rows.map((r) => r.action)).toContain('LOGIN_UNLOCKED');

    const after = await request(app).get('/api/v1/admin/users').query({ q: email }).set(bearer(admin.token)).expect(200);
    expect(after.body.data.users[0].loginLockedUntil).toBeNull();
  });
});

describe('two-factor codes', () => {
  test('wrong codes after a right password count too; a right password alone does not end the streak', async () => {
    const email = uniqueEmail();
    await seedAdmin({ email, password: DEFAULT_PASSWORD, totpSecret: ADMIN_TOTP_SECRET });
    const step = async () => (await login(app, email, DEFAULT_PASSWORD).expect(200)).body.data.mfaToken;
    const wrongCode = async (mfaToken) => request(app).post('/api/v1/auth/login/2fa').send({ mfaToken, code: '000000' });

    await failTimes(email, 3);
    const token = await step(); // right password: the 3 failures stay
    expect((await wrongCode(token)).body.error.code).toBe('INVALID_TWO_FACTOR_CODE');
    const locked = await wrongCode(token);
    expect(locked.body.error.code).toBe('LOGIN_LOCKED');

    // Locked: neither the password step nor a right code gets in.
    await login(app, email, DEFAULT_PASSWORD).expect(429);
    const fresh = await request(app).post('/api/v1/auth/login/2fa').send({ mfaToken: token, code: totpAt(ADMIN_TOTP_SECRET) });
    expect(fresh.status).toBe(429);
  });
});

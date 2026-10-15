const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { redis } = require('../../src/redis/client');
const { totpAt } = require('../../src/utils/totp');
const { seedAdmin } = require('../../src/scripts/seedAdmin');
const { resetTwoFactorByEmail } = require('../../src/scripts/resetTwoFactor');
const { useFakeMailbox, uniqueEmail, login, createLoggedInUser, loginWithTwoFactor, ADMIN_TOTP_SECRET } = require('../helpers/auth');
const { bearer, createAdmin } = require('../helpers/catalog');

/**
 * Phase 15: two-factor authentication with an authenticator app.
 * See docs/phase-15-two-factor-design.md.
 *
 * A code works once per 30-second step, and the server accepts the step
 * before and after "now". Each test uses at most two codes per account:
 * `code(secret)` (this step) then `code(secret, 1)` (the next one), which
 * stay valid even if the clock moves on to the next step meanwhile.
 */
const app = createApp();
const mailbox = useFakeMailbox();
const PASSWORD = 'AdminPass123';
const STEP_MS = 30_000;
const code = (secret, steps = 0) => totpAt(secret, Date.now() + steps * STEP_MS);
const RECOVERY_CODE = /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

let admin;
beforeAll(async () => {
  admin = await createAdmin(app);
});
afterAll(() => closePool());

const post = (path, body, token) => {
  const req = request(app).post(`/api/v1${path}`).send(body);
  return token ? req.set(bearer(token)) : req;
};
const status = (token) => request(app).get('/api/v1/users/me/2fa').set(bearer(token));
const userIdOf = async (email) => (await query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id;

/** An admin without two-factor yet (as after `npm run seed:admin` in production). */
async function newAdmin({ totpSecret } = {}) {
  const email = uniqueEmail();
  await seedAdmin({ email, password: PASSWORD, totpSecret });
  return email;
}

/** A customer who turned two-factor on from their account page; returns the secret and the codes. */
async function customerWithTwoFactor() {
  const user = await createLoggedInUser(app, mailbox);
  const { setup } = (await post('/users/me/2fa/setup', { password: user.password }, user.session.accessToken).expect(200)).body.data;
  const confirmed = (await post('/users/me/2fa/confirm', { code: code(setup.secret) }, user.session.accessToken).expect(200)).body.data;
  return { ...user, secret: setup.secret, recoveryCodes: confirmed.recoveryCodes, token: confirmed.accessToken, refreshToken: confirmed.refreshToken };
}

describe('logging in', () => {
  test('without two-factor (a customer who did not turn it on): as before, one step', async () => {
    const user = await createLoggedInUser(app, mailbox);
    expect(user.session).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect(user.session.mfaRequired).toBeUndefined();
  });

  test('an admin without two-factor must set it up: QR code, first code, 10 recovery codes, then the session', async () => {
    const email = await newAdmin();
    const first = (await login(app, email, PASSWORD).expect(200)).body.data;
    expect(first).toEqual({ mfaSetupRequired: true, mfaToken: expect.any(String), expiresIn: 300 });

    const { setup } = (await post('/auth/login/2fa/setup', { mfaToken: first.mfaToken }).expect(200)).body.data;
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUri).toContain(`otpauth://totp/ETP%20Tickets:${encodeURIComponent(email)}?secret=${setup.secret}`);
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const wrong = await post('/auth/login/2fa/setup/confirm', { mfaToken: first.mfaToken, code: '000000' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_TWO_FACTOR_CODE', details: { attemptsLeft: 4 } });

    const done = (await post('/auth/login/2fa/setup/confirm', { mfaToken: first.mfaToken, code: code(setup.secret) }).expect(200)).body.data;
    expect(done).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String), user: { email, roles: ['ADMIN'] } });
    expect(done.recoveryCodes).toHaveLength(10);
    expect(done.recoveryCodes.every((c) => RECOVERY_CODE.test(c))).toBe(true);
    expect((await status(done.accessToken).expect(200)).body.data.twoFactor).toEqual({
      enabled: true,
      enabledAt: expect.any(String),
      required: true,
      recoveryCodesLeft: 10,
    });
    const { rows } = await query(`SELECT mfa FROM refresh_tokens WHERE user_id = $1`, [await userIdOf(email)]);
    expect(rows).toEqual([{ mfa: true }]);
    expect(mailbox.subjects(email)).toEqual(['Đã bật xác thực hai lớp']);

    // The sign-in step is used up; the next login asks for a code.
    expect((await post('/auth/login/2fa/setup', { mfaToken: first.mfaToken })).body.error.code).toBe('MFA_TOKEN_INVALID');
    expect((await login(app, email, PASSWORD).expect(200)).body.data).toMatchObject({ mfaRequired: true });
  });

  test('a code works once: the same code for a second login is refused', async () => {
    const email = await newAdmin({ totpSecret: ADMIN_TOTP_SECRET });
    const first = (await login(app, email, PASSWORD)).body.data;
    const ok = (await post('/auth/login/2fa', { mfaToken: first.mfaToken, code: code(ADMIN_TOTP_SECRET) }).expect(200)).body.data;
    expect(ok.user.roles).toEqual(['ADMIN']);

    const second = (await login(app, email, PASSWORD)).body.data;
    const again = await post('/auth/login/2fa', { mfaToken: second.mfaToken, code: code(ADMIN_TOTP_SECRET) });
    expect(again.body.error.code).toBe('INVALID_TWO_FACTOR_CODE');
    await post('/auth/login/2fa', { mfaToken: second.mfaToken, code: code(ADMIN_TOTP_SECRET, 1) }).expect(200);
  });

  test('five wrong codes end the sign-in step, even for the right code after', async () => {
    const email = await newAdmin({ totpSecret: ADMIN_TOTP_SECRET });
    const { mfaToken } = (await login(app, email, PASSWORD)).body.data;
    const left = [];
    for (let i = 0; i < 4; i += 1) {
      left.push((await post('/auth/login/2fa', { mfaToken, code: '000000' })).body.error.details.attemptsLeft);
    }
    expect(left).toEqual([4, 3, 2, 1]);
    // Phase 18.1: the 5th wrong code also locks the email (codes count like passwords).
    expect((await post('/auth/login/2fa', { mfaToken, code: '000000' })).body.error.code).toBe('LOGIN_LOCKED');
    const late = await post('/auth/login/2fa', { mfaToken, code: code(ADMIN_TOTP_SECRET) });
    expect(late.status).toBe(429);
    expect(late.body.error.code).toBe('LOGIN_LOCKED');
  });

  test('an mfaToken is not an access token, has a purpose, and cannot be forged', async () => {
    const email = await newAdmin();
    const { mfaToken } = (await login(app, email, PASSWORD)).body.data; // purpose "setup"
    expect((await request(app).get('/api/v1/auth/me').set(bearer(mfaToken))).status).toBe(401);
    expect((await post('/auth/login/2fa', { mfaToken, code: '123456' })).body.error.code).toBe('MFA_TOKEN_INVALID');
    const forged = `${mfaToken.slice(0, -4)}AAAA`;
    expect((await post('/auth/login/2fa/setup', { mfaToken: forged })).body.error.code).toBe('MFA_TOKEN_INVALID');
    expect((await post('/auth/login/2fa', { mfaToken, code: '123456', recoveryCode: 'ABCDE-FGHJK' })).status).toBe(400);
  });

  test('two logins with the same code at the same moment: exactly one gets a session', async () => {
    const email = await newAdmin({ totpSecret: ADMIN_TOTP_SECRET });
    const tokens = [];
    for (let i = 0; i < 5; i += 1) tokens.push((await login(app, email, PASSWORD)).body.data.mfaToken);
    const same = code(ADMIN_TOTP_SECRET);
    const results = await Promise.all(tokens.map((mfaToken) => post('/auth/login/2fa', { mfaToken, code: same })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === 'INVALID_TWO_FACTOR_CODE')).toHaveLength(4);
  });

  test('one sign-in step used twice at the same moment: one session', async () => {
    const email = await newAdmin({ totpSecret: ADMIN_TOTP_SECRET });
    const { mfaToken } = (await login(app, email, PASSWORD)).body.data;
    const results = await Promise.all([
      post('/auth/login/2fa', { mfaToken, code: code(ADMIN_TOTP_SECRET) }),
      post('/auth/login/2fa', { mfaToken, code: code(ADMIN_TOTP_SECRET, 1) }),
    ]);
    // Whichever wins, the other loses: at marking the step used (401), or, when the later
    // code was claimed first, because the earlier code is now an old one (422).
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.map((r) => r.body.error?.code).filter(Boolean)[0]).toMatch(/^(MFA_TOKEN_INVALID|INVALID_TWO_FACTOR_CODE)$/);
  });

  test('Redis down: the code step answers 503 rather than counting nothing', async () => {
    const email = await newAdmin({ totpSecret: ADMIN_TOTP_SECRET });
    const { mfaToken } = (await login(app, email, PASSWORD)).body.data;
    const spy = jest.spyOn(redis, 'mget').mockRejectedValueOnce(new Error('Connection is closed.'));
    try {
      const res = await post('/auth/login/2fa', { mfaToken, code: code(ADMIN_TOTP_SECRET) });
      expect(res.status).toBe(503);
    } finally {
      spy.mockRestore();
    }
    await post('/auth/login/2fa', { mfaToken, code: code(ADMIN_TOTP_SECRET) }).expect(200); // nothing was used up
  });

  test('web app (cookie mode): "remember me" chosen at step 1 decides the cookie of step 2', async () => {
    const email = await newAdmin({ totpSecret: ADMIN_TOTP_SECRET });
    const cookieMode = (req) => req.set('X-Auth-Transport', 'cookie');
    const step = async (remember, steps) => {
      const { mfaToken } = (await cookieMode(request(app).post('/api/v1/auth/login')).send({ email, password: PASSWORD, remember })).body.data;
      return cookieMode(request(app).post('/api/v1/auth/login/2fa')).send({ mfaToken, code: code(ADMIN_TOTP_SECRET, steps) }).expect(200);
    };
    const remembered = await step(true, 0);
    expect(remembered.body.data.refreshToken).toBeUndefined();
    expect(remembered.headers['set-cookie'][0]).toMatch(/^etp_refresh=.*Max-Age=604800/);
    const forgotten = await step(false, 1);
    expect(forgotten.headers['set-cookie'][0]).not.toMatch(/Max-Age|Expires/);
  });
});

describe('refresh: a session without two-factor ends for someone who needs it', () => {
  test('a customer made admin while signed in must log in again, with two-factor', async () => {
    const user = await createLoggedInUser(app, mailbox);
    await request(app).put(`/api/v1/admin/users/${await userIdOf(user.email)}/roles`).set(bearer(admin.token)).send({ roles: ['ADMIN'] }).expect(200);

    const res = await post('/auth/refresh', { refreshToken: user.session.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
    expect((await post('/auth/refresh', { refreshToken: user.session.refreshToken })).body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  test('turning two-factor on ends the other sessions; the new session goes on', async () => {
    const user = await createLoggedInUser(app, mailbox);
    const otherDevice = (await login(app, user.email, user.password).expect(200)).body.data;
    const { setup } = (await post('/users/me/2fa/setup', { password: user.password }, user.session.accessToken).expect(200)).body.data;
    const confirmed = (await post('/users/me/2fa/confirm', { code: code(setup.secret) }, user.session.accessToken).expect(200)).body.data;

    expect((await post('/auth/refresh', { refreshToken: otherDevice.refreshToken })).status).toBe(401);
    expect((await post('/auth/refresh', { refreshToken: user.session.refreshToken })).status).toBe(401);
    const next = await post('/auth/refresh', { refreshToken: confirmed.refreshToken }).expect(200);
    await status(next.body.data.accessToken).expect(200);
  });

  test('sessions opened with two-factor rotate as usual', async () => {
    const res = await loginWithTwoFactor(app, await newAdmin({ totpSecret: ADMIN_TOTP_SECRET }), PASSWORD);
    const rotated = await post('/auth/refresh', { refreshToken: res.body.data.refreshToken }).expect(200);
    await post('/auth/refresh', { refreshToken: rotated.body.data.refreshToken }).expect(200);
  });
});

describe('my two-factor settings', () => {
  test('a customer turns it on (password, then a code) and off (password + code)', async () => {
    const user = await createLoggedInUser(app, mailbox);
    const token = user.session.accessToken;
    expect((await status(token)).body.data.twoFactor).toEqual({ enabled: false, enabledAt: null, required: false, recoveryCodesLeft: 0 });
    expect((await post('/users/me/2fa/setup', { password: 'wrong-password' }, token)).body.error.code).toBe('WRONG_PASSWORD');
    expect((await post('/users/me/2fa/confirm', { code: '123456' }, token)).body.error.code).toBe('TWO_FACTOR_SETUP_NOT_STARTED');

    const { setup } = (await post('/users/me/2fa/setup', { password: user.password }, token).expect(200)).body.data;
    expect((await post('/users/me/2fa/confirm', { code: '000000' }, token)).body.error.code).toBe('INVALID_TWO_FACTOR_CODE');
    const on = (await post('/users/me/2fa/confirm', { code: code(setup.secret) }, token).expect(200)).body.data;
    expect(on.recoveryCodes).toHaveLength(10);
    expect((await post('/users/me/2fa/setup', { password: user.password }, on.accessToken)).body.error.code).toBe('TWO_FACTOR_ALREADY_ENABLED');

    const disable = (body) => post('/users/me/2fa/disable', body, on.accessToken);
    expect((await disable({ password: 'wrong-password', code: code(setup.secret, 1) })).body.error.code).toBe('WRONG_PASSWORD');
    const off = (await disable({ password: user.password, code: code(setup.secret, 1) }).expect(200)).body.data;
    expect(off.twoFactor.enabled).toBe(false);
    expect(mailbox.subjects(user.email).slice(-2)).toEqual(['Đã bật xác thực hai lớp', 'Đã tắt xác thực hai lớp']);
    expect((await login(app, user.email, user.password).expect(200)).body.data.accessToken).toEqual(expect.any(String));
  });

  test('an admin cannot turn it off', async () => {
    const res = await post('/users/me/2fa/disable', { password: 'AdminPass123', code: '123456' }, admin.token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TWO_FACTOR_REQUIRED');
  });

  test('recovery codes: each works once, typed loosely; a new set replaces the old; an email when one is used', async () => {
    const user = await customerWithTwoFactor();
    const viaRecovery = async (recoveryCode) => {
      const { mfaToken } = (await login(app, user.email, user.password).expect(200)).body.data;
      return post('/auth/login/2fa', { mfaToken, recoveryCode });
    };
    const [first, second] = user.recoveryCodes;
    expect((await viaRecovery(` ${first.toLowerCase().replace('-', '')} `)).status).toBe(200);
    expect(mailbox.subjects(user.email).at(-1)).toBe('Một mã khôi phục vừa được dùng');
    expect(mailbox.latestText(user.email)).toContain('Còn 9 mã');
    expect((await viaRecovery(first)).body.error.code).toBe('INVALID_TWO_FACTOR_CODE');

    const renewed = (await post('/users/me/2fa/recovery-codes', { code: code(user.secret, 1) }, user.token).expect(200)).body.data;
    expect(renewed.recoveryCodes).toHaveLength(10);
    expect((await viaRecovery(second)).body.error.code).toBe('INVALID_TWO_FACTOR_CODE');
    expect((await viaRecovery(renewed.recoveryCodes[0])).status).toBe(200);
  });
});

describe('reset by an administrator', () => {
  test('ends the sessions, writes the audit log and emails the user; never for oneself', async () => {
    const user = await customerWithTwoFactor();
    const userId = await userIdOf(user.email);
    const reset = (id, body) => post(`/admin/users/${id}/2fa/reset`, body, admin.token);

    expect((await reset(userId, {})).status).toBe(400); // a reason is required
    const res = await reset(userId, { reason: 'Mất điện thoại' }).expect(200);
    expect(res.body.data.user).toMatchObject({ id: userId, twoFactorEnabled: false });
    expect((await post('/auth/refresh', { refreshToken: user.refreshToken })).status).toBe(401);
    expect(mailbox.subjects(user.email).at(-1)).toBe('Xác thực hai lớp đã được đặt lại');
    const audit = await request(app).get('/api/v1/admin/audit-logs').query({ entityId: userId }).set(bearer(admin.token)).expect(200);
    expect(audit.body.data.auditLogs[0]).toMatchObject({ action: 'TWO_FACTOR_RESET', newValue: { twoFactorEnabled: false, reason: 'Mất điện thoại' } });
    // A customer logs in with the password alone again.
    expect((await login(app, user.email, user.password).expect(200)).body.data.accessToken).toEqual(expect.any(String));

    expect((await reset(userId, { reason: 'Lần nữa' })).body.error.code).toBe('TWO_FACTOR_NOT_ENABLED');
    expect((await reset(await userIdOf(admin.email), { reason: 'Của chính mình' })).body.error.code).toBe('CANNOT_CHANGE_SELF');
  });

  test('the admin users list shows who has two-factor', async () => {
    const user = await customerWithTwoFactor();
    const list = await request(app).get('/api/v1/admin/users').query({ q: user.email }).set(bearer(admin.token)).expect(200);
    expect(list.body.data.users).toEqual([expect.objectContaining({ email: user.email, twoFactorEnabled: true })]);
  });

  test('the server script, for the last admin who lost their phone: set it up again at the next login', async () => {
    const email = await newAdmin({ totpSecret: ADMIN_TOTP_SECRET });
    expect(await resetTwoFactorByEmail(email)).toEqual({ email, wasOn: true });
    expect((await login(app, email, PASSWORD).expect(200)).body.data).toMatchObject({ mfaSetupRequired: true });
    await expect(resetTwoFactorByEmail('nobody@example.com')).rejects.toThrow('No account');
  });
});

const express = require('express');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { closePool } = require('../../src/database/pool');
const authenticate = require('../../src/middleware/authenticate');
const authorize = require('../../src/middleware/authorize');
const errorHandler = require('../../src/middleware/errorHandler');
const { seedAdmin } = require('../../src/scripts/seedAdmin');
const { useFakeMailbox, uniqueEmail, login, createLoggedInUser, loginWithTwoFactor, ADMIN_TOTP_SECRET } = require('../helpers/auth');

const app = createApp();
const mailbox = useFakeMailbox();

afterAll(() => closePool());

/** A tiny app with one admin-only route, to exercise authenticate + authorize. */
function appWithProtectedRoute() {
  const protectedApp = express();
  protectedApp.get('/admin-only', authenticate, authorize('event:approve'), (req, res) => {
    res.json({ success: true, data: { userId: req.user.id } });
  });
  protectedApp.use(errorHandler);
  return protectedApp;
}

describe('seedAdmin (npm run seed:admin)', () => {
  test('creates a verified ADMIN who can log in, and is idempotent', async () => {
    const email = uniqueEmail();
    const password = 'AdminPass123';

    const first = await seedAdmin({ email, password });
    const second = await seedAdmin({ email, password: 'Different999' });
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ userId: first.userId, created: false });

    // The second run did not overwrite the password: it is still right, and
    // an admin without two-factor is sent to set it up first (Phase 15).
    const first2 = await login(app, email, password).expect(200);
    expect(first2.body.data).toMatchObject({ mfaSetupRequired: true, mfaToken: expect.any(String) });
    expect(first2.body.data.accessToken).toBeUndefined();

    await seedAdmin({ email, password, totpSecret: ADMIN_TOTP_SECRET });
    const res = await loginWithTwoFactor(app, email, password);
    expect(res.body.data.user.roles).toEqual(['ADMIN']);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`)
      .expect(200);
    expect(me.body.data.user.permissions).toEqual(expect.arrayContaining(['event:approve', 'user:manage', 'booking:create']));
  });
});

describe('authorize(permission)', () => {
  const protectedApp = appWithProtectedRoute();

  test('a CUSTOMER gets 403 FORBIDDEN', async () => {
    const { session } = await createLoggedInUser(app, mailbox);
    const res = await request(protectedApp)
      .get('/admin-only')
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('an ADMIN is allowed', async () => {
    const email = uniqueEmail();
    await seedAdmin({ email, password: 'AdminPass123', totpSecret: ADMIN_TOTP_SECRET });
    const { body } = await loginWithTwoFactor(app, email, 'AdminPass123');

    await request(protectedApp)
      .get('/admin-only')
      .set('Authorization', `Bearer ${body.data.accessToken}`)
      .expect(200);
  });

  test('no token → 401 before any permission check', async () => {
    const res = await request(protectedApp).get('/admin-only');
    expect(res.status).toBe(401);
  });
});

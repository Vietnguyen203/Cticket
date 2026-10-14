const { randomUUID } = require('node:crypto');
const request = require('supertest');
const mailer = require('../../src/mail/mailer');
const { totpAt } = require('../../src/utils/totp');

const OTP_PATTERN = /\b(\d{6})\b/;
const DEFAULT_PASSWORD = 'Secret123';

/**
 * Replace SMTP with an in-memory outbox for the current test file.
 * Call once at the top of a test file; emails are cleared before each test.
 */
function useFakeMailbox() {
  const sendMail = jest.spyOn(mailer, 'sendMail').mockResolvedValue(undefined);
  beforeEach(() => sendMail.mockClear());
  afterAll(() => sendMail.mockRestore());

  const messagesTo = (email) => sendMail.mock.calls.map(([message]) => message).filter((m) => m.to === email);

  return {
    count: (email) => messagesTo(email).length,
    subjects: (email) => messagesTo(email).map((message) => message.subject),
    latestText: (email) => messagesTo(email).at(-1)?.text,
    /** The 6-digit code from the most recent email to this address. */
    latestOtp(email) {
      const messages = messagesTo(email);
      if (messages.length === 0) throw new Error(`No email was sent to ${email}`);
      return OTP_PATTERN.exec(messages.at(-1).text)[1];
    },
  };
}

const uniqueEmail = () => `user-${randomUUID().slice(0, 12)}@example.com`;

function registerUser(app, overrides = {}) {
  const body = {
    email: uniqueEmail(),
    password: DEFAULT_PASSWORD,
    firstName: 'Lan',
    lastName: 'Nguyen',
    ...overrides,
  };
  return request(app).post('/api/v1/auth/register').send(body).then((res) => ({ res, ...body }));
}

function verifyEmail(app, email, otp) {
  return request(app).post('/api/v1/auth/otp/verify').send({ email, purpose: 'EMAIL_VERIFICATION', otp });
}

function login(app, email, password = DEFAULT_PASSWORD) {
  return request(app).post('/api/v1/auth/login').send({ email, password });
}

/**
 * Phase 15: the TOTP secret of every admin the tests seed. Tests compute its
 * codes; each admin has its own "last used step", so admins never collide.
 */
const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/** Password, then the code from the "authenticator app": a full session (the 200 response of step 2). */
async function loginWithTwoFactor(app, email, password, secret = ADMIN_TOTP_SECRET) {
  const first = await login(app, email, password).expect(200);
  if (!first.body.data.mfaRequired) throw new Error(`Expected a two-factor step for ${email}`);
  return request(app).post('/api/v1/auth/login/2fa').send({ mfaToken: first.body.data.mfaToken, code: totpAt(secret) }).expect(200);
}

/** Register + verify; returns credentials of an ACTIVE customer. */
async function createVerifiedUser(app, mailbox) {
  const { email, password } = await registerUser(app);
  await verifyEmail(app, email, mailbox.latestOtp(email)).expect(200);
  return { email, password };
}

/** Register + verify + login; returns credentials and the login response body. */
async function createLoggedInUser(app, mailbox) {
  const credentials = await createVerifiedUser(app, mailbox);
  const res = await login(app, credentials.email, credentials.password).expect(200);
  return { ...credentials, session: res.body.data };
}

module.exports = {
  DEFAULT_PASSWORD,
  useFakeMailbox,
  uniqueEmail,
  registerUser,
  verifyEmail,
  login,
  ADMIN_TOTP_SECRET,
  loginWithTwoFactor,
  createVerifiedUser,
  createLoggedInUser,
};

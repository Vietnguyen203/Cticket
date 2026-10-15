const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const env = require('../../config/env');
const { TWO_FACTOR, USER_STATUS } = require('../../config/constants');
const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { encryptSecret, decryptSecret, hmacSha256 } = require('../../utils/crypto');
const totp = require('../../utils/totp');
const { redis } = require('../../redis/client');
const { QUEUE, enqueue } = require('../../queue/queues');
const mailer = require('../../mail/mailer');
const { twoFactorEmail } = require('../../mail/templates');
const users = require('../users');
const repository = require('./two-factor.repository');
const authRepository = require('./auth.repository');
const tokens = require('./auth.tokens');
const sessions = require('./sessions');
const denylist = require('./denylist');
const loginGuard = require('./login-guard');

/**
 * Two-factor authentication with an authenticator app (Phase 15).
 * See docs/phase-15-two-factor-design.md.
 */

const ALERT = Object.freeze({
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
  RESET: 'RESET',
  RECOVERY_CODE_USED: 'RECOVERY_CODE_USED',
});

const isRequiredFor = (roles) => roles.some((role) => env.TWO_FACTOR_REQUIRED_ROLES.includes(role));

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** A code for an ENABLED secret: right, newer than the last one used, and claimed now (once). */
async function useTotpCode(db, userId, code) {
  const row = await repository.findTotp(db, userId);
  if (!row?.enabled_at) return false;
  const secret = decryptSecret(row.secret_encrypted, env.TOTP_ENCRYPTION_KEY);
  const step = totp.verifyTotp(secret, code, { afterStep: Number(row.last_used_step) });
  return step !== null && repository.claimStep(db, userId, step);
}

// Recovery codes: 10 characters from an alphabet without look-alikes (no 0/O,
// 1/I), shown as "ABCDE-FGH23". 32 symbols = 5 bits each, ~50 bits per code.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 10;
const RECOVERY_GROUP = 5;

function newRecoveryCode() {
  const raw = Array.from({ length: RECOVERY_LENGTH }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]).join('');
  return `${raw.slice(0, RECOVERY_GROUP)}-${raw.slice(RECOVERY_GROUP)}`;
}

/** Keyed hash (like the email codes): ~50 bits could be brute-forced from a leaked plain hash. */
const hashRecoveryCode = (userId, code) =>
  hmacSha256(env.OTP_SECRET, `recovery:${userId}:${code.toUpperCase().replace(/[^A-Z0-9]/g, '')}`);

/** A new set (the old one stops working). The plain codes are returned once and never stored. */
async function issueRecoveryCodes(db, userId) {
  const codes = Array.from({ length: TWO_FACTOR.RECOVERY_CODES }, newRecoveryCode);
  await repository.replaceRecoveryCodes(db, userId, codes.map((code) => hashRecoveryCode(userId, code)));
  return codes;
}

/** A new pending secret (two-factor not on yet) and what the phone needs: QR code or the key typed in. */
async function startSetupFor(db, user) {
  const secret = totp.generateSecret();
  if (!(await repository.savePendingSecret(db, user.id, encryptSecret(secret, env.TOTP_ENCRYPTION_KEY)))) {
    throw new AppError('TWO_FACTOR_ALREADY_ENABLED');
  }
  const otpauthUri = totp.otpauthUri({ issuer: env.TOTP_ISSUER, account: user.email, secret });
  return { secret, otpauthUri, qrDataUrl: await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 }) };
}

/**
 * First code of a set-up, in the caller's transaction: the pending secret is
 * locked, so a set-up restarted in another tab cannot slip in between.
 * @returns {Promise<string[]|null>} the recovery codes, or null for a wrong code
 */
async function enableWithCode(client, userId, code) {
  const row = await repository.findTotp(client, userId, { forUpdate: true });
  if (!row) throw new AppError('TWO_FACTOR_SETUP_NOT_STARTED');
  if (row.enabled_at) throw new AppError('TWO_FACTOR_ALREADY_ENABLED');
  const step = totp.verifyTotp(decryptSecret(row.secret_encrypted, env.TOTP_ENCRYPTION_KEY), code);
  if (step === null) return null;
  await repository.enableTotp(client, userId, step);
  return issueRecoveryCodes(client, userId);
}

// ---------------------------------------------------------------------------
// Security emails
// ---------------------------------------------------------------------------

/** Queued, never failing the action itself (it is already done). */
async function queueAlert(user, alert, data = {}) {
  try {
    await enqueue(QUEUE.EMAILS, 'two-factor-alert', { to: user.email, firstName: user.first_name, alert, ...data });
  } catch (err) {
    logger.error({ err, userId: user.id, alert }, 'Two-factor alert email could not be queued');
  }
}

/** The emails worker. Throws so that the job is retried. */
async function sendAlertEmail({ to, firstName, alert, codesLeft }) {
  await mailer.sendMail({ to, ...twoFactorEmail({ alert, firstName, codesLeft }) });
}

// ---------------------------------------------------------------------------
// Login, step 2. The mfaToken (5 minutes) proves the password was right; Redis
// counts its wrong codes and marks it used. Without Redis there is nowhere
// safe to count, so the step answers 503 instead of guessing (like OTP codes).
// ---------------------------------------------------------------------------

const attemptsKey = (jti) => `mfa:attempts:${jti}`;
const usedKey = (jti) => `mfa:used:${jti}`;
const secondsLeft = (claims) => Math.max(1, claims.expiresAt - Math.floor(Date.now() / 1000));

async function withRedis(operation) {
  try {
    return await operation();
  } catch (err) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Two-factor sign-in is temporarily unavailable. Please try again.', { cause: err });
  }
}

async function assertUsable(claims) {
  const [used, attempts] = await withRedis(() => redis.mget(usedKey(claims.jti), attemptsKey(claims.jti)));
  if (used !== null || Number(attempts ?? 0) >= TWO_FACTOR.MAX_ATTEMPTS) throw new AppError('MFA_TOKEN_INVALID');
}

/** Phase 18.1: a wrong code counts like a wrong password for the account's email. */
async function failWrongCode(claims, user) {
  const { locked, lockSeconds } = await loginGuard.failAndMaybeAlert(pool, user.email, user);
  if (locked) throw new AppError('LOGIN_LOCKED', undefined, { details: { retryAfterSeconds: lockSeconds } });
  const [[, count]] = await withRedis(() =>
    redis.multi().incr(attemptsKey(claims.jti)).expire(attemptsKey(claims.jti), secondsLeft(claims)).exec(),
  );
  throw new AppError('INVALID_TWO_FACTOR_CODE', undefined, {
    details: { attemptsLeft: Math.max(0, TWO_FACTOR.MAX_ATTEMPTS - count) },
  });
}

/** Single use: of two requests with the same mfaToken, exactly one gets a session. */
async function markUsed(claims) {
  const set = await withRedis(() => redis.set(usedKey(claims.jti), '1', 'EX', secondsLeft(claims), 'NX'));
  if (set !== 'OK') throw new AppError('MFA_TOKEN_INVALID');
}

async function activeUser(userId) {
  const user = await users.findById(pool, userId);
  if (!user) throw new AppError('MFA_TOKEN_INVALID');
  if (user.status !== USER_STATUS.ACTIVE) throw new AppError('ACCOUNT_DISABLED');
  return user;
}

/**
 * After a right password: does the login need a code? 'verify' (two-factor
 * on), 'setup' (a role that requires it, not set up yet), or null.
 */
async function loginChallenge(db, user, roles) {
  if ((await repository.findTotp(db, user.id))?.enabled_at) return 'verify';
  return isRequiredFor(roles) ? 'setup' : null;
}

/** Refresh gate: true when a session opened without two-factor must not go on. */
async function needsTwoFactor(db, userId, roles) {
  return isRequiredFor(roles) || Boolean((await repository.findTotp(db, userId))?.enabled_at);
}

/** POST /auth/login/2fa: a code from the app, or a recovery code. */
async function verifyLogin({ mfaToken, code, recoveryCode }, meta) {
  const claims = tokens.verifyMfaToken(mfaToken, 'verify');
  const user = await activeUser(claims.userId);
  await loginGuard.assertNotLocked(pool, user.email);
  await assertUsable(claims);

  const ok = code
    ? await useTotpCode(pool, user.id, code)
    : await repository.useRecoveryCode(pool, user.id, hashRecoveryCode(user.id, recoveryCode));
  if (!ok) await failWrongCode(claims, user);
  await markUsed(claims);
  await loginGuard.clear(pool, user.email);

  const roles = await users.findRoleCodes(pool, user.id);
  const session = await sessions.openSession(pool, { user, roles, meta, mfa: true });
  if (!code) {
    await queueAlert(user, ALERT.RECOVERY_CODE_USED, { codesLeft: await repository.countRecoveryCodesLeft(pool, user.id) });
  }
  return { session, remember: claims.remember };
}

/** POST /auth/login/2fa/setup: an admin without two-factor gets a secret to scan. */
async function startLoginSetup({ mfaToken }) {
  const claims = tokens.verifyMfaToken(mfaToken, 'setup');
  const user = await activeUser(claims.userId);
  await assertUsable(claims);
  return startSetupFor(pool, user);
}

/** POST /auth/login/2fa/setup/confirm: the first code → two-factor on, recovery codes, and the session. */
async function confirmLoginSetup({ mfaToken, code }, meta) {
  const claims = tokens.verifyMfaToken(mfaToken, 'setup');
  const user = await activeUser(claims.userId);
  await loginGuard.assertNotLocked(pool, user.email);
  await assertUsable(claims);

  const result = await withTransaction(async (client) => {
    const recoveryCodes = await enableWithCode(client, user.id, code);
    if (!recoveryCodes) return null; // rolled back: nothing was written
    await markUsed(claims);
    const roles = await users.findRoleCodes(client, user.id);
    return { recoveryCodes, session: await sessions.openSession(client, { user, roles, meta, mfa: true }) };
  });
  if (!result) await failWrongCode(claims, user);
  await loginGuard.clear(pool, user.email);
  await queueAlert(user, ALERT.ENABLED);
  return { ...result, remember: claims.remember };
}

// ---------------------------------------------------------------------------
// My two-factor settings (signed in)
// ---------------------------------------------------------------------------

async function assertPassword(user, password) {
  if (!(await bcrypt.compare(password, user.password_hash))) throw new AppError('WRONG_PASSWORD');
}

async function getStatus(userId) {
  const row = await repository.findTotp(pool, userId);
  const enabled = Boolean(row?.enabled_at);
  return {
    enabled,
    enabledAt: row?.enabled_at ?? null,
    required: isRequiredFor(await users.findRoleCodes(pool, userId)),
    recoveryCodesLeft: enabled ? await repository.countRecoveryCodesLeft(pool, userId) : 0,
  };
}

/** Asks for the password again: a session left open on someone's computer is not enough. */
async function startSetup(userId, { password }) {
  const user = await users.findById(pool, userId);
  await assertPassword(user, password);
  return startSetupFor(pool, user);
}

/**
 * Two-factor on. Every other session of the user ends (their next refresh
 * asks for a login with a code; their access tokens stop now); this one is
 * replaced by a new session opened with two-factor.
 */
async function confirmSetup(userId, { code }, meta) {
  const user = await users.findById(pool, userId);
  const result = await withTransaction(async (client) => {
    const recoveryCodes = await enableWithCode(client, userId, code);
    if (!recoveryCodes) throw new AppError('INVALID_TWO_FACTOR_CODE');
    await authRepository.revokeAllRefreshTokensOfUser(client, userId);
    // Same-second tokens stay valid: the one issued just below.
    client.afterCommit(() => denylist.revokeAllTokensOfUser(userId));
    const roles = await users.findRoleCodes(client, userId);
    return { recoveryCodes, session: await sessions.openSession(client, { user, roles, meta, mfa: true }) };
  });
  await queueAlert(user, ALERT.ENABLED);
  return result;
}

/** Off, with the password and a code. Not for a role that requires two-factor. */
async function disable(userId, { password, code }) {
  const user = await users.findById(pool, userId);
  if (isRequiredFor(await users.findRoleCodes(pool, userId))) throw new AppError('TWO_FACTOR_REQUIRED');
  await assertPassword(user, password);
  if (!(await repository.findTotp(pool, userId))?.enabled_at) throw new AppError('TWO_FACTOR_NOT_ENABLED');
  if (!(await useTotpCode(pool, userId, code))) throw new AppError('INVALID_TWO_FACTOR_CODE');
  await repository.deleteTwoFactor(pool, userId);
  await queueAlert(user, ALERT.DISABLED);
}

/** A fresh set of recovery codes (the old set stops working), with a code from the app. */
async function regenerateRecoveryCodes(userId, { code }) {
  if (!(await repository.findTotp(pool, userId))?.enabled_at) throw new AppError('TWO_FACTOR_NOT_ENABLED');
  if (!(await useTotpCode(pool, userId, code))) throw new AppError('INVALID_TWO_FACTOR_CODE');
  return { recoveryCodes: await withTransaction((client) => issueRecoveryCodes(client, userId)) };
}

// ---------------------------------------------------------------------------
// Reset by an administrator / the server script; seeding for test stacks
// ---------------------------------------------------------------------------

/**
 * Test stacks only (`seed:admin` with ADMIN_TOTP_SECRET): two-factor on with
 * a secret the tests know, so they can compute codes. Leaves an enabled one alone.
 */
async function enableKnownSecret(client, userId, secret) {
  if (await repository.savePendingSecret(client, userId, encryptSecret(secret, env.TOTP_ENCRYPTION_KEY))) {
    await repository.enableTotp(client, userId, 0);
  }
}

/**
 * Turn two-factor off for someone who lost their phone, in the caller's
 * transaction (the caller also ends their sessions and writes the audit log).
 * @returns {Promise<boolean>} false when it was not set up
 */
function resetTwoFactor(client, userId) {
  return repository.deleteTwoFactor(client, userId);
}

module.exports = {
  ALERT,
  isRequiredFor,
  loginChallenge,
  needsTwoFactor,
  verifyLogin,
  startLoginSetup,
  confirmLoginSetup,
  getStatus,
  startSetup,
  confirmSetup,
  disable,
  regenerateRecoveryCodes,
  resetTwoFactor,
  enableKnownSecret,
  queueAlert,
  sendAlertEmail,
};

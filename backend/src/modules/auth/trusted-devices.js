const { randomBytes } = require('node:crypto');
const { TWO_FACTOR } = require('../../config/constants');
const { sha256 } = require('../../utils/crypto');

/**
 * "Ghi nhớ đăng nhập": a browser where the user passed the two-factor step
 * with the box ticked gets a device cookie (refresh-cookie.js), and skips the
 * code there for TWO_FACTOR.TRUSTED_DEVICE_DAYS. The password is still asked;
 * the session itself still ends when the browser is closed.
 *
 * Never for a role that requires two-factor (admins): they always type a code.
 * Forgotten when the password is reset, two-factor is turned off or reset,
 * the account is deleted, or the user asks ("Quên các thiết bị").
 * Only a hash of the token is stored.
 */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new trusted browser; returns the token for its cookie. Keeps at most TRUSTED_DEVICES_PER_USER. */
async function trustDevice(db, { userId, userAgent }) {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  await db.query(
    `INSERT INTO trusted_devices (user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [userId, sha256(token), userAgent ? String(userAgent).slice(0, 300) : null, TWO_FACTOR.TRUSTED_DEVICE_DAYS],
  );
  await db.query(
    `DELETE FROM trusted_devices
     WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM trusted_devices WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT $2)`,
    [userId, TWO_FACTOR.TRUSTED_DEVICES_PER_USER],
  );
  return token;
}

/** Is this browser's token a trusted device of this user, still in date? (Marks it used.) */
async function isTrusted(db, userId, token) {
  if (!token || !TOKEN_PATTERN.test(token)) return false;
  const { rowCount } = await db.query(
    `UPDATE trusted_devices SET last_used_at = now()
     WHERE user_id = $1 AND token_hash = $2 AND expires_at > now()`,
    [userId, sha256(token)],
  );
  return rowCount === 1;
}

/**
 * The user's trusted browsers in date, newest first. (Which one is "this
 * browser" cannot be told: the device cookie only goes to /api/v1/auth.)
 */
async function listDevices(db, userId) {
  const { rows } = await db.query(
    `SELECT user_agent, created_at, last_used_at, expires_at
     FROM trusted_devices WHERE user_id = $1 AND expires_at > now()
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((row) => ({ userAgent: row.user_agent, createdAt: row.created_at, lastUsedAt: row.last_used_at, expiresAt: row.expires_at }));
}

/** Forget every trusted browser of the user (in the caller's transaction, if any). */
async function forgetDevices(db, userId) {
  await db.query(`DELETE FROM trusted_devices WHERE user_id = $1`, [userId]);
}

module.exports = { trustDevice, isTrusted, listDevices, forgetDevices };

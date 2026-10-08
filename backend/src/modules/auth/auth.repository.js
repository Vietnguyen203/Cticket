/**
 * SQL for refresh_tokens and user_tokens (OTP codes).
 * Expiry times are computed by PostgreSQL (now() + interval), so issuing and
 * checking use the same clock even if the API server's clock drifts.
 */

// ---------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------

async function insertRefreshToken(db, { userId, tokenHash, familyId, ttlDays, ipAddress, userAgent }) {
  const { rows } = await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5, $6)
     RETURNING id`,
    [userId, tokenHash, familyId, ttlDays, ipAddress, userAgent],
  );
  return rows[0].id;
}

/** Locks the token row so two refreshes of the same token run one after the other. */
async function findRefreshTokenForUpdate(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT rt.id, rt.user_id, rt.family_id, rt.revoked_at, rt.replaced_by_id,
            rt.expires_at <= now() AS expired,
            u.status AS user_status
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
     FOR UPDATE OF rt`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

async function markRefreshTokenRotated(db, tokenId, replacedById) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), replaced_by_id = $2 WHERE id = $1`,
    [tokenId, replacedById],
  );
}

async function revokeRefreshTokenFamily(db, familyId) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  );
}

/** Logout: revoke every token of the session the given token belongs to. */
async function revokeFamilyByTokenHash(db, tokenHash) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)
       AND revoked_at IS NULL`,
    [tokenHash],
  );
}

/** Password reset: log the user out of every device. */
async function revokeAllRefreshTokensOfUser(db, userId) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

// ---------------------------------------------------------------------------
// OTP codes (user_tokens)
// ---------------------------------------------------------------------------

/** How many codes were issued in the last hour, and is the latest still in cooldown? */
async function getOtpIssueStats(db, { userId, type, cooldownSeconds }) {
  const { rows } = await db.query(
    `SELECT count(*) AS issued_last_hour,
            count(*) FILTER (WHERE created_at > now() - make_interval(secs => $3)) > 0 AS in_cooldown
     FROM user_tokens
     WHERE user_id = $1 AND type = $2 AND created_at > now() - interval '1 hour'`,
    [userId, type, cooldownSeconds],
  );
  return { issuedLastHour: rows[0].issued_last_hour, inCooldown: rows[0].in_cooldown };
}

async function revokeActiveOtps(db, { userId, type }) {
  await db.query(
    `UPDATE user_tokens SET revoked_at = now()
     WHERE user_id = $1 AND type = $2 AND used_at IS NULL AND revoked_at IS NULL`,
    [userId, type],
  );
}

async function insertOtp(db, { userId, type, tokenHash, ttlMinutes }) {
  await db.query(
    `INSERT INTO user_tokens (user_id, type, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, type, tokenHash, ttlMinutes],
  );
}

async function findActiveOtpForUpdate(db, { userId, type }) {
  const { rows } = await db.query(
    `SELECT id, token_hash, attempts, expires_at <= now() AS expired
     FROM user_tokens
     WHERE user_id = $1 AND type = $2 AND used_at IS NULL AND revoked_at IS NULL
     FOR UPDATE`,
    [userId, type],
  );
  return rows[0] ?? null;
}

/** Count a wrong guess; revoke the code once the limit is reached. */
async function recordFailedOtpAttempt(db, { tokenId, maxAttempts }) {
  await db.query(
    `UPDATE user_tokens
     SET attempts = attempts + 1,
         revoked_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE revoked_at END
     WHERE id = $1`,
    [tokenId, maxAttempts],
  );
}

async function revokeOtp(db, tokenId) {
  await db.query(`UPDATE user_tokens SET revoked_at = now() WHERE id = $1`, [tokenId]);
}

async function markOtpUsed(db, tokenId) {
  await db.query(`UPDATE user_tokens SET used_at = now() WHERE id = $1`, [tokenId]);
}

module.exports = {
  insertRefreshToken,
  findRefreshTokenForUpdate,
  markRefreshTokenRotated,
  revokeRefreshTokenFamily,
  revokeFamilyByTokenHash,
  revokeAllRefreshTokensOfUser,
  getOtpIssueStats,
  revokeActiveOtps,
  insertOtp,
  findActiveOtpForUpdate,
  recordFailedOtpAttempt,
  revokeOtp,
  markOtpUsed,
};

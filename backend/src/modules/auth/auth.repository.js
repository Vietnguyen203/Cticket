/**
 * SQL for refresh_tokens. (OTP codes moved to Redis in Phase 6: see otp.service.js.)
 * Expiry times are computed by PostgreSQL (now() + interval), so issuing and
 * checking use the same clock even if the API server's clock drifts.
 */

// ---------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------

/** `mfa`: the session was opened with two-factor (Phase 15); kept by every rotation. */
async function insertRefreshToken(db, { userId, tokenHash, familyId, ttlDays, ipAddress, userAgent, mfa = false }) {
  const { rows } = await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, ip_address, user_agent, mfa)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5, $6, $7)
     RETURNING id`,
    [userId, tokenHash, familyId, ttlDays, ipAddress, userAgent, mfa],
  );
  return rows[0].id;
}

/** Locks the token row so two refreshes of the same token run one after the other. */
async function findRefreshTokenForUpdate(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT rt.id, rt.user_id, rt.family_id, rt.revoked_at, rt.replaced_by_id, rt.mfa,
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

module.exports = {
  insertRefreshToken,
  findRefreshTokenForUpdate,
  markRefreshTokenRotated,
  revokeRefreshTokenFamily,
  revokeFamilyByTokenHash,
  revokeAllRefreshTokensOfUser,
};

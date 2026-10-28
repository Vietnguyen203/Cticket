/**
 * SQL for two-factor authentication (Phase 15): user_totp and user_recovery_codes.
 * The secret arrives here already encrypted; recovery codes already hashed.
 */

/** @returns {Promise<{ secret_encrypted: string, enabled_at: Date|null, last_used_step: string }|null>} */
async function findTotp(db, userId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT secret_encrypted, enabled_at, last_used_step FROM user_totp WHERE user_id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Start (or restart) a set-up with a new secret. Never touches a secret that
 * is already enabled: turning two-factor off is a separate, checked action.
 * @returns {Promise<boolean>} false when two-factor is already on
 */
async function savePendingSecret(db, userId, secretEncrypted) {
  const { rowCount } = await db.query(
    `INSERT INTO user_totp (user_id, secret_encrypted) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET secret_encrypted = EXCLUDED.secret_encrypted, last_used_step = 0, created_at = now()
       WHERE user_totp.enabled_at IS NULL`,
    [userId, secretEncrypted],
  );
  return rowCount === 1;
}

/** The first code was right: two-factor is on. Compare-and-set, so it happens once. */
async function enableTotp(db, userId, step) {
  const { rowCount } = await db.query(
    `UPDATE user_totp SET enabled_at = now(), last_used_step = $2 WHERE user_id = $1 AND enabled_at IS NULL`,
    [userId, step],
  );
  return rowCount === 1;
}

/**
 * Use up a 30-second step. Two requests with the same code at the same moment:
 * exactly one moves last_used_step forward, the other changes nothing.
 * @returns {Promise<boolean>}
 */
async function claimStep(db, userId, step) {
  const { rowCount } = await db.query(
    `UPDATE user_totp SET last_used_step = $2
     WHERE user_id = $1 AND enabled_at IS NOT NULL AND last_used_step < $2`,
    [userId, step],
  );
  return rowCount === 1;
}

/** Two-factor off (by the user or reset by an admin): the secret and every recovery code go. */
async function deleteTwoFactor(db, userId) {
  const { rowCount } = await db.query(`DELETE FROM user_totp WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
  // The browsers that skipped the code ("Ghi nhớ đăng nhập") must not skip a new one.
  await db.query(`DELETE FROM trusted_devices WHERE user_id = $1`, [userId]);
  return rowCount === 1;
}

/** A new set of recovery codes; the previous set stops working. */
async function replaceRecoveryCodes(db, userId, codeHashes) {
  await db.query(`DELETE FROM user_recovery_codes WHERE user_id = $1`, [userId]);
  await db.query(
    `INSERT INTO user_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])`,
    [userId, codeHashes],
  );
}

/** Use a recovery code once (compare-and-set on used_at). @returns {Promise<boolean>} */
async function useRecoveryCode(db, userId, codeHash) {
  const { rowCount } = await db.query(
    `UPDATE user_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
    [userId, codeHash],
  );
  return rowCount === 1;
}

async function countRecoveryCodesLeft(db, userId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS left FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  return rows[0].left;
}

module.exports = {
  findTotp,
  savePendingSecret,
  enableTotp,
  claimStep,
  deleteTwoFactor,
  replaceRecoveryCodes,
  useRecoveryCode,
  countRecoveryCodesLeft,
};

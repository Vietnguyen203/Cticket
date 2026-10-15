const crypto = require('node:crypto');
const env = require('../../config/env');
const { LOGIN_LOCK } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { QUEUE, enqueue } = require('../../queue/queues');

/**
 * Phase 18.1: a pause after repeated wrong passwords for one email.
 * See docs/phase-18-customer-features-design.md, section 2.
 *
 * - Counted per email, for unknown emails too (the answer never tells which
 *   emails have an account), in PostgreSQL (Redis is fail-open: a lock kept
 *   there would vanish exactly when it matters).
 * - FAILURES wrong passwords / two-factor codes in a row → locked for
 *   FIRST_LOCK_SECONDS, doubled at each further lock, at most MAX_LOCK_SECONDS.
 * - While locked the password is not even checked.
 * - A full sign-in, a password reset or an admin clears it.
 * The IP rate limit stays: it stops one computer trying many emails; this
 * stops many computers trying one email.
 */

/** Not the email itself: the table holds strangers' typos too. */
function emailHash(email) {
  return crypto.createHmac('sha256', env.OTP_SECRET).update(`login:${String(email).trim().toLowerCase()}`).digest('hex');
}

/** @throws AppError LOGIN_LOCKED (429, with retryAfterSeconds) */
async function assertNotLocked(db, email) {
  const { rows } = await db.query(
    `SELECT ceil(extract(epoch FROM locked_until - now()))::int AS seconds
     FROM login_attempts WHERE email_hash = $1 AND locked_until > now()`,
    [emailHash(email)],
  );
  if (rows[0]) {
    throw new AppError('LOGIN_LOCKED', undefined, { details: { retryAfterSeconds: Math.max(1, rows[0].seconds) } });
  }
}

/**
 * One more failure for this email; every FAILURES-th one locks it. One
 * statement (the row lock of ON CONFLICT orders concurrent failures), so 20
 * wrong passwords at once still count 20.
 * @returns {Promise<{ locked: boolean, lockLevel: number, lockSeconds: number }>}
 */
async function recordFailure(db, email) {
  // Only the conflicting row's own values (a.*), never a subquery: those are
  // read from the statement's snapshot and would lose concurrent failures.
  const streakOver = `a.last_failure_at < now() - make_interval(secs => $3)`;
  const failures = `(CASE WHEN ${streakOver} THEN 0 ELSE a.failures END + 1)`;
  const level = `(CASE WHEN ${streakOver} THEN 0 ELSE a.lock_level END)`;
  const { rows } = await db.query(
    `INSERT INTO login_attempts AS a (email_hash, failures, lock_level, locked_until, last_failure_at)
     VALUES ($1, 1, 0, NULL, now())
     ON CONFLICT (email_hash) DO UPDATE SET
       failures = ${failures},
       lock_level = ${level} + CASE WHEN ${failures} % $2 = 0 THEN 1 ELSE 0 END,
       locked_until = CASE WHEN ${failures} % $2 = 0
                           THEN now() + make_interval(secs => least($4 * power(2, ${level}), $5))
                           ELSE a.locked_until END,
       last_failure_at = now()
     RETURNING failures, lock_level, failures % $2 = 0 AS locked,
               ceil(extract(epoch FROM locked_until - now()))::int AS lock_seconds`,
    [emailHash(email), LOGIN_LOCK.FAILURES, LOGIN_LOCK.STREAK_RESET_SECONDS, LOGIN_LOCK.FIRST_LOCK_SECONDS, LOGIN_LOCK.MAX_LOCK_SECONDS],
  );
  const row = rows[0];
  return { locked: row.locked, lockLevel: row.lock_level, lockSeconds: row.lock_seconds ?? 0 };
}

/** A full sign-in, a password reset or an admin: the streak is over. */
async function clear(db, email) {
  await db.query(`DELETE FROM login_attempts WHERE email_hash = $1`, [emailHash(email)]);
}

/** Admin list: which of these emails are locked now, and until when. @returns {Promise<Map<string, Date>>} */
async function lockedUntilOf(db, emails) {
  if (emails.length === 0) return new Map();
  const byHash = new Map(emails.map((email) => [emailHash(email), email]));
  const { rows } = await db.query(
    `SELECT email_hash, locked_until FROM login_attempts WHERE email_hash = ANY($1) AND locked_until > now()`,
    [[...byHash.keys()]],
  );
  return new Map(rows.map((row) => [byHash.get(row.email_hash), row.locked_until]));
}

/** Maintenance: streaks that ended long ago. */
async function purgeOld(db) {
  const { rowCount } = await db.query(
    `DELETE FROM login_attempts
     WHERE last_failure_at < now() - make_interval(secs => $1) AND (locked_until IS NULL OR locked_until < now())`,
    [LOGIN_LOCK.STREAK_RESET_SECONDS],
  );
  return rowCount;
}

/**
 * A failure that may lock the email; on the first lock of a streak, the
 * owner (if the account exists) is told by email. Never fails the request.
 */
async function failAndMaybeAlert(db, email, user) {
  const result = await recordFailure(db, email);
  if (result.locked && result.lockLevel === 1 && user) {
    try {
      await enqueue(QUEUE.EMAILS, 'login-locked', {
        to: user.email,
        firstName: user.first_name,
        minutes: Math.round(result.lockSeconds / 60),
      });
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Login lock alert could not be queued');
    }
  }
  return result;
}

module.exports = { assertNotLocked, recordFailure, failAndMaybeAlert, clear, lockedUntilOf, purgeOld, emailHash };

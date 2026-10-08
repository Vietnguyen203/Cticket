const env = require('../../config/env');
const { OTP } = require('../../config/constants');
const logger = require('../../utils/logger');
const { hmacSha256, randomNumericCode, safeEqualHex } = require('../../utils/crypto');
const mailer = require('../../mail/mailer');
const { otpEmail } = require('../../mail/templates');
const authRepository = require('./auth.repository');

/**
 * The stored hash binds the code to one user and one purpose: the same
 * "123456" for another user, or for password reset, produces another hash.
 */
function hashOtp(userId, purpose, code) {
  return hmacSha256(env.OTP_SECRET, `${userId}:${purpose}:${code}`);
}

/**
 * Create a new code, revoking any previous one. Runs inside the caller's
 * transaction, which must already hold the user's row lock (so two concurrent
 * requests cannot both pass the limits below).
 *
 * @returns {Promise<string|null>} the plain code, or null when the resend
 *   cooldown or the hourly limit is reached
 */
async function issueOtp(client, userId, purpose) {
  const stats = await authRepository.getOtpIssueStats(client, {
    userId,
    type: purpose,
    cooldownSeconds: OTP.RESEND_COOLDOWN_SECONDS,
  });
  if (stats.inCooldown || stats.issuedLastHour >= OTP.MAX_PER_HOUR) {
    return null;
  }

  await authRepository.revokeActiveOtps(client, { userId, type: purpose });
  const code = randomNumericCode(OTP.LENGTH);
  await authRepository.insertOtp(client, {
    userId,
    type: purpose,
    tokenHash: hashOtp(userId, purpose, code),
    ttlMinutes: OTP.TTL_MINUTES,
  });
  return code;
}

/**
 * Check a code and mark it used. Runs inside the caller's transaction.
 *
 * A wrong guess is RECORDED in the database, so the caller must COMMIT even
 * when this returns false. Throwing inside the transaction would roll the
 * counter back and give an attacker unlimited guesses.
 *
 * @returns {Promise<boolean>}
 */
async function consumeOtp(client, userId, purpose, code) {
  const token = await authRepository.findActiveOtpForUpdate(client, { userId, type: purpose });
  if (!token) {
    return false;
  }
  if (token.expired) {
    await authRepository.revokeOtp(client, token.id);
    return false;
  }
  if (!safeEqualHex(hashOtp(userId, purpose, code), token.token_hash)) {
    await authRepository.recordFailedOtpAttempt(client, { tokenId: token.id, maxAttempts: OTP.MAX_ATTEMPTS });
    return false;
  }
  await authRepository.markOtpUsed(client, token.id);
  return true;
}

/**
 * Email the code. A failed send is logged, not thrown: the account is already
 * saved and the user can request a new code. The code itself is never logged.
 */
async function sendOtpEmail(user, purpose, code) {
  try {
    await mailer.sendMail({
      to: user.email,
      ...otpEmail({ purpose, code, firstName: user.first_name, ttlMinutes: OTP.TTL_MINUTES }),
    });
  } catch (err) {
    logger.error({ err, userId: user.id, purpose }, 'Failed to send OTP email');
  }
}

module.exports = { issueOtp, consumeOtp, sendOtpEmail };

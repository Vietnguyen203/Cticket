const env = require('../../config/env');
const { OTP } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { hmacSha256, randomNumericCode } = require('../../utils/crypto');
const { redis } = require('../../redis/client');
const mailer = require('../../mail/mailer');
const { otpEmail } = require('../../mail/templates');

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/**
 * The stored hash binds the code to one user and one purpose: the same
 * "123456" for another user, or for password reset, produces another hash.
 */
function hashOtp(userId, purpose, code) {
  return hmacSha256(env.OTP_SECRET, `${userId}:${purpose}:${code}`);
}

/** Redis keys of one user's code for one purpose (the client adds the "etp:" prefix). */
function otpKeys(userId, purpose) {
  return {
    code: `otp:${purpose}:${userId}`,
    cooldown: `otp:cooldown:${purpose}:${userId}`,
    hourly: `otp:hourly:${purpose}:${userId}`,
  };
}

/**
 * Codes live only in Redis, so unlike cache or rate limits there is nothing
 * to fall back to: report 503 and let the client retry.
 */
async function withRedis(operation) {
  try {
    return await operation();
  } catch (err) {
    throw new AppError('SERVICE_UNAVAILABLE', 'Verification codes are temporarily unavailable. Please try again.', {
      cause: err,
    });
  }
}

/**
 * Create a new code, replacing any previous one. The resend cooldown and the
 * hourly cap are checked in the same atomic Lua script, so parallel requests
 * cannot slip past them (no row lock needed any more).
 *
 * @returns {Promise<string|null>} the plain code, or null when a limit applies
 */
async function issueOtp(userId, purpose) {
  const code = randomNumericCode(OTP.LENGTH);
  const keys = otpKeys(userId, purpose);
  const issued = await withRedis(() =>
    redis.otpIssue(
      keys.code,
      keys.cooldown,
      keys.hourly,
      hashOtp(userId, purpose, code),
      OTP.TTL_MINUTES * SECONDS_PER_MINUTE,
      OTP.RESEND_COOLDOWN_SECONDS,
      SECONDS_PER_HOUR,
      OTP.MAX_PER_HOUR,
    ),
  );
  return issued === 1 ? code : null;
}

/**
 * Check a code and use it up. A wrong guess is counted atomically; at
 * MAX_ATTEMPTS the code is deleted, so even the right code stops working.
 * Two concurrent requests with the right code: exactly one gets true.
 * @returns {Promise<boolean>}
 */
async function consumeOtp(userId, purpose, code) {
  const result = await withRedis(() =>
    redis.otpConsume(otpKeys(userId, purpose).code, hashOtp(userId, purpose, code), OTP.MAX_ATTEMPTS),
  );
  return result === 1;
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

module.exports = { issueOtp, consumeOtp, sendOtpEmail, otpKeys };

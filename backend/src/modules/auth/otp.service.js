const env = require('../../config/env');
const { OTP } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { hmacSha256, randomNumericCode } = require('../../utils/crypto');
const { redis } = require('../../redis/client');
const mailer = require('../../mail/mailer');
const { QUEUE, enqueue } = require('../../queue/queues');
const { otpEmail } = require('../../mail/templates');

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const OTP_JOB_FAILED_RETENTION_SECONDS = SECONDS_PER_HOUR;

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
 * Queue the email (Q-02): the request does not wait for SMTP, and a failed
 * send is retried by the worker. The code travels in the job data, so the
 * job is deleted as soon as it is sent, and within an hour if every attempt
 * failed (the code expires after 10 minutes anyway). It is never logged.
 */
async function queueOtpEmail(user, purpose, code) {
  await enqueue(
    QUEUE.EMAILS,
    'otp',
    { to: user.email, firstName: user.first_name, purpose, code },
    { removeOnComplete: true, removeOnFail: { age: OTP_JOB_FAILED_RETENTION_SECONDS } },
  );
}

/** The emails worker: send the code. Throws so that the job is retried. */
async function sendOtpEmail({ to, firstName, purpose, code }) {
  await mailer.sendMail({ to, ...otpEmail({ purpose, code, firstName, ttlMinutes: OTP.TTL_MINUTES }) });
}

module.exports = { issueOtp, consumeOtp, queueOtpEmail, sendOtpEmail, otpKeys };

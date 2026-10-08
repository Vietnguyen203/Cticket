const crypto = require('node:crypto');

const OPAQUE_TOKEN_BYTES = 32; // 256 bits: impossible to guess

/** URL-safe random token, e.g. for refresh tokens. */
function randomToken(bytes = OPAQUE_TOKEN_BYTES) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256 is enough for HIGH-entropy secrets (random 256-bit tokens): nobody
 * can brute-force 2^256 values, so no secret key is needed.
 */
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * HMAC with a server-side key, for LOW-entropy secrets like 6-digit codes.
 * A plain SHA-256 of a 6-digit code can be reversed by hashing all
 * 1,000,000 possibilities; an HMAC cannot without the key.
 */
function hmacSha256(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

/**
 * Uniformly random numeric code, zero-padded ("004217").
 * crypto.randomInt is cryptographically secure; Math.random() is predictable.
 */
function randomNumericCode(length) {
  return crypto.randomInt(0, 10 ** length).toString().padStart(length, '0');
}

/**
 * Compare two hex digests in constant time. A normal `===` returns as soon as
 * one character differs, which leaks through response timing how many leading
 * characters were right.
 */
function safeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { randomToken, sha256, hmacSha256, randomNumericCode, safeEqualHex };

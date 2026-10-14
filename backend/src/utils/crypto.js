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

const ENCRYPTION_VERSION = 'v1';
const GCM_IV_BYTES = 12;

/**
 * Encrypt a secret the server must be able to READ again later (a TOTP
 * secret: a hash would not do, the server computes codes from it).
 * AES-256-GCM: a fresh random IV per value, and an auth tag, so a value that
 * was tampered with fails to decrypt instead of decrypting to garbage.
 * Stored as "v1:iv:tag:ciphertext" (base64url); the version allows a key
 * change later.
 * @param {string} plaintext
 * @param {Buffer} key 32 bytes
 */
function encryptSecret(plaintext, key) {
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [ENCRYPTION_VERSION, iv, cipher.getAuthTag(), data].map((part) => (Buffer.isBuffer(part) ? part.toString('base64url') : part)).join(':');
}

/** @throws if the value was tampered with or encrypted with another key */
function decryptSecret(box, key) {
  const [version, iv, tag, data] = box.split(':');
  if (version !== ENCRYPTION_VERSION || !iv || !tag || data === undefined) throw new Error('Unknown encrypted value format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = { randomToken, sha256, hmacSha256, randomNumericCode, safeEqualHex, encryptSecret, decryptSecret };

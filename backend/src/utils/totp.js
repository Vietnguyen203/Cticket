const crypto = require('node:crypto');

/**
 * Time-based one-time passwords (RFC 6238), what authenticator apps
 * (Google / Microsoft Authenticator, Authy…) show: both sides share a secret
 * and compute HMAC-SHA1(secret, number of 30-second steps since 1970), cut
 * down to 6 digits (RFC 4226 "dynamic truncation"). Written out here instead
 * of a library: it is short, and every step is tested against the RFC.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20; // 160 bits, the size RFC 4226 recommends for HMAC-SHA1

// RFC 4648 base32: how authenticator apps take a secret (QR code or typed in).
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BITS_PER_CHAR = 5;
const BITS_PER_BYTE = 8;

function base32Encode(buffer) {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << BITS_PER_BYTE) | byte;
    bits += BITS_PER_BYTE;
    while (bits >= BITS_PER_CHAR) {
      bits -= BITS_PER_CHAR;
      out += BASE32_ALPHABET[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1; // keep only the bits not written yet
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (BITS_PER_CHAR - bits)) & 31];
  return out;
}

/** Accepts lower case, spaces and "=" padding, as people type a secret by hand. */
function base32Decode(text) {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  let value = 0;
  let bits = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character');
    value = (value << BITS_PER_CHAR) | index;
    bits += BITS_PER_CHAR;
    if (bits >= BITS_PER_BYTE) {
      bits -= BITS_PER_BYTE;
      bytes.push((value >>> bits) & 255);
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(bytes);
}

/** A new random secret, base32 (what the QR code and the "type it in" key carry). */
function generateSecret() {
  return base32Encode(crypto.randomBytes(SECRET_BYTES));
}

/** RFC 4226: the code for one counter value (here, one 30-second step). */
function hotp(key, counter, digits = DIGITS) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

const stepAt = (timeMs) => Math.floor(timeMs / 1000 / STEP_SECONDS);

/** The code an authenticator app shows at `timeMs` for a base32 secret. */
function totpAt(secret, timeMs = Date.now(), digits = DIGITS) {
  return hotp(base32Decode(secret), stepAt(timeMs), digits);
}

/**
 * Check a code against the steps around `timeMs` (± window, for clocks that
 * are a little off), skipping steps at or before `afterStep`: a code that was
 * already used must never work again (the caller stores the step it returns).
 * @returns {number|null} the step the code belongs to, or null
 */
function verifyTotp(secret, code, { timeMs = Date.now(), window = 1, afterStep = 0 } = {}) {
  if (typeof code !== 'string' || !/^\d+$/.test(code) || code.length !== DIGITS) return null;
  const key = base32Decode(secret);
  const now = stepAt(timeMs);
  let found = null;
  // Every candidate is compared (in constant time), so the response time does not tell which step matched.
  for (let step = now - window; step <= now + window; step += 1) {
    const matches = crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code));
    if (matches && step > afterStep && found === null) found = step;
  }
  return found;
}

/** What the QR code holds: authenticator apps read the issuer, account and secret from it. */
function otpauthUri({ issuer, account, secret }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

module.exports = { base32Encode, base32Decode, generateSecret, hotp, totpAt, verifyTotp, otpauthUri, STEP_SECONDS, DIGITS };

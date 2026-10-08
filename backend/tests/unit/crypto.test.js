const { randomNumericCode, safeEqualHex, hmacSha256, sha256 } = require('../../src/utils/crypto');
const { escapeHtml } = require('../../src/mail/templates');

const SAMPLES = 2000;

describe('randomNumericCode', () => {
  test('always returns exactly 6 digits, keeping leading zeros', () => {
    const codes = Array.from({ length: SAMPLES }, () => randomNumericCode(6));
    expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true);
    // With 2000 samples, ~10% start with "0": padding must preserve them.
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
  });
});

describe('hashing helpers', () => {
  test('HMAC depends on the key; SHA-256 does not', () => {
    expect(hmacSha256('key-a', '123456')).not.toBe(hmacSha256('key-b', '123456'));
    expect(sha256('abc')).toBe(sha256('abc'));
  });

  test('safeEqualHex compares digests and handles length mismatch', () => {
    const digest = sha256('value');
    expect(safeEqualHex(digest, sha256('value'))).toBe(true);
    expect(safeEqualHex(digest, sha256('other'))).toBe(false);
    expect(safeEqualHex(digest, 'abcd')).toBe(false);
  });
});

describe('escapeHtml', () => {
  test('neutralizes HTML in user-provided names', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
});

const crypto = require('node:crypto');
const { base32Encode, base32Decode, generateSecret, hotp, totpAt, verifyTotp, otpauthUri } = require('../../src/utils/totp');
const { encryptSecret, decryptSecret } = require('../../src/utils/crypto');

// RFC 6238, appendix B: SHA-1, the ASCII secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const at = (seconds) => seconds * 1000;

describe('base32 (RFC 4648)', () => {
  test('known values, and decode(encode(x)) = x', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar'); // as people type it
    const bytes = crypto.randomBytes(20);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(() => base32Decode('ABC1')).toThrow('Invalid base32 character');
  });

  test('a new secret is 160 random bits (32 base32 characters)', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateSecret()).not.toBe(secret);
  });
});

describe('TOTP (RFC 6238 test vectors)', () => {
  test.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('at %i s: %s (8 digits)', (seconds, code) => {
    expect(totpAt(RFC_SECRET, at(seconds), 8)).toBe(code);
  });

  test('6 digits are the last 6 of the same value', () => {
    expect(totpAt(RFC_SECRET, at(59))).toBe('287082');
    expect(hotp(base32Decode(RFC_SECRET), 1)).toBe('287082'); // 59 s = step 1
  });
});

describe('verifyTotp', () => {
  const now = at(1234567890); // step 41152263
  const step = Math.floor(1234567890 / 30);

  test('accepts the current step and one step either side (clock drift), not two', () => {
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), { timeMs: now })).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), { timeMs: now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30_000), { timeMs: now })).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 60_000), { timeMs: now })).toBeNull();
  });

  test('a step already used (or older) never works again', () => {
    const code = totpAt(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, { timeMs: now, afterStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { timeMs: now, afterStep: step - 1 })).toBe(step);
  });

  test('anything but 6 digits is refused without error', () => {
    for (const code of ['', '12345', '1234567', '12a456', undefined, 123456]) {
      expect(verifyTotp(RFC_SECRET, code, { timeMs: now })).toBeNull();
    }
  });

  test('the otpauth:// URI that the QR code carries', () => {
    const uri = otpauthUri({ issuer: 'ETP Tickets', account: 'a@b.vn', secret: 'ABC' });
    expect(uri).toBe('otpauth://totp/ETP%20Tickets:a%40b.vn?secret=ABC&issuer=ETP+Tickets&algorithm=SHA1&digits=6&period=30');
  });
});

describe('encryptSecret (AES-256-GCM)', () => {
  const key = crypto.randomBytes(32);

  test('decrypts back; the same value encrypts differently each time (random IV)', () => {
    const box = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(box).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(decryptSecret(box, key)).toBe('JBSWY3DPEHPK3PXP');
    expect(encryptSecret('JBSWY3DPEHPK3PXP', key)).not.toBe(box);
  });

  test('a tampered value or another key fails instead of giving garbage', () => {
    const box = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const [version, iv, tag, data] = box.split(':');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() => decryptSecret([version, iv, tag, flipped.toString('base64url')].join(':'), key)).toThrow();
    expect(() => decryptSecret(box, crypto.randomBytes(32))).toThrow();
    expect(() => decryptSecret('plain-text', key)).toThrow('Unknown encrypted value format');
  });
});

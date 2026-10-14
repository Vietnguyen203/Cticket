import { createHmac } from 'node:crypto'

/**
 * The "authenticator app" of the E2E tests (RFC 6238, as backend/src/utils/totp.js):
 * the 6-digit code for a base32 secret, `steps` 30-second steps from now.
 * A code works once per account, so a test that needs two codes for the same
 * account uses this step, then the next one (the server accepts ±1 step).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(text: string): Buffer {
  let value = 0
  let bits = 0
  const bytes: number[] = []
  for (const char of text.toUpperCase().replace(/[\s=]/g, '')) {
    value = (value << 5) | ALPHABET.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 255)
    }
    value &= (1 << bits) - 1
  }
  return Buffer.from(bytes)
}

export function totpCode(secret: string, steps = 0): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + steps))
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
  return String(binary % 1_000_000).padStart(6, '0')
}

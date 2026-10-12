const env = require('../../config/env');
const { hmacSha256, sha256, safeEqualHex } = require('../../utils/crypto');

const TOKEN_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9][0-9]{0,8})\.([0-9a-f]{64})$/;

/**
 * Content of a ticket's QR code: "<ticket id>.<qr version>.<HMAC>".
 *
 * - No personal data, only the ticket id.
 * - Cannot be forged or edited without QR_SECRET (the signature would not match).
 * - Deterministic, so it can be shown again at any time without being stored;
 *   the database keeps only its SHA-256 (tickets.qr_token_hash), used to find
 *   the ticket at the gate (Phase 10).
 * - Re-issuing a QR (TKT-03) bumps qr_version: every copy of the old code stops working.
 */
function qrToken(ticketId, version) {
  const payload = `${ticketId}.${version}`;
  return `${payload}.${hmacSha256(env.QR_SECRET, payload)}`;
}

const qrTokenHash = (token) => sha256(token);

/**
 * Read a scanned QR (CHK-01): checks the shape, then the signature in
 * constant time. Anything edited or made up without QR_SECRET gives null.
 * @returns {{ ticketId: string, version: number } | null}
 */
function parseQrToken(token) {
  const match = TOKEN_PATTERN.exec(String(token).trim());
  if (!match) return null;
  const [, ticketId, version, signature] = match;
  if (!safeEqualHex(signature, hmacSha256(env.QR_SECRET, `${ticketId}.${version}`))) return null;
  return { ticketId, version: Number(version) };
}

module.exports = { qrToken, qrTokenHash, parseQrToken };

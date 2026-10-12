const env = require('../../config/env');
const { hmacSha256, sha256 } = require('../../utils/crypto');

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

module.exports = { qrToken, qrTokenHash };

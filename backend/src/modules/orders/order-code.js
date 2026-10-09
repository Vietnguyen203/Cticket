const { randomInt } = require('node:crypto');

// No 0/O or 1/I: order codes are read out loud to support staff.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RANDOM_LENGTH = 6; // 32^6 ≈ 1 billion codes per day
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "ETP-261009-7KQ2XM": the date is the customer's (Vietnam) date. */
function generateOrderCode(now = new Date()) {
  const date = new Date(now.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(2, 10).replaceAll('-', '');
  let random = '';
  for (let i = 0; i < RANDOM_LENGTH; i += 1) {
    random += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `ETP-${date}-${random}`;
}

module.exports = { generateOrderCode };

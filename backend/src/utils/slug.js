const crypto = require('node:crypto');

const MAX_SLUG_BASE_LENGTH = 80;
const SUFFIX_BYTES = 3; // 6 hex characters

/**
 * "Đêm nhạc Sơn Tùng M-TP 2026!" → "dem-nhac-son-tung-m-tp-2026"
 * NFD splits "ạ" into "a" + a combining dot; the combining marks are then
 * removed. "đ" is a separate letter (not a + mark), so it is mapped by hand.
 */
function slugify(text) {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_BASE_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'item';
}

/** Slug plus a short random suffix, for things that often share a title (events). */
function uniqueSlug(text) {
  return `${slugify(text)}-${crypto.randomBytes(SUFFIX_BYTES).toString('hex')}`;
}

module.exports = { slugify, uniqueSlug };

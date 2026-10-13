const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const { detectImageType } = require('./image-type');

/** Where the API serves uploaded images; what is stored in events.banner_url / thumbnail_url. */
const PUBLIC_PREFIX = '/api/v1/uploads/images/';

/**
 * Save an uploaded event image under a random name (never the client's file
 * name: no path tricks, no collisions, nothing guessable).
 * @returns {Promise<{ url: string, contentType: string, size: number }>}
 */
async function saveImage(buffer) {
  const type = detectImageType(buffer);
  if (!type) throw new AppError('IMAGE_INVALID');
  const fileName = `${randomUUID()}.${type.ext}`;
  await fs.mkdir(env.UPLOAD_DIR, { recursive: true });
  // 'wx': fail rather than overwrite (a UUID collision is practically impossible).
  await fs.writeFile(path.join(env.UPLOAD_DIR, fileName), buffer, { flag: 'wx' });
  return { url: PUBLIC_PREFIX + fileName, contentType: type.mime, size: buffer.length };
}

module.exports = { saveImage, PUBLIC_PREFIX };

const express = require('express');
const env = require('../../config/env');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const { rateLimit, LIMITS } = require('../../middleware/rateLimit');
const { ACCEPTED_TYPES } = require('./image-type');
const controller = require('./uploads.controller');

const MAX_IMAGE_SIZE = '5mb';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Mounted at /api/v1/uploads (Phase 12.2: event images uploaded from the computer). */
const router = express.Router();

// Whoever edits events or venues may upload pictures for them.
router.post(
  '/images',
  authenticate,
  authorize.any('event:create', 'event:update:own', 'event:manage:any', 'venue:manage', 'venue:propose'),
  rateLimit(LIMITS.upload),
  express.raw({ type: ACCEPTED_TYPES, limit: MAX_IMAGE_SIZE }),
  controller.uploadImage,
);

// Files are never changed (new upload = new random name): cache them for a year.
// nosniff: browsers must not guess another type than the one we checked.
router.use(
  '/images',
  express.static(env.UPLOAD_DIR, {
    index: false,
    dotfiles: 'deny',
    immutable: true,
    maxAge: ONE_YEAR_SECONDS * 1000,
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
  }),
);

module.exports = router;

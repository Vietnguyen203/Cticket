const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const AppError = require('../../utils/AppError');
const schemas = require('./payments.schemas');
const controller = require('./payments.controller');

// Printable ASCII without spaces: what clients generate (UUIDs, random strings).
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{8,255}$/;

/** PAY-01: every payment request carries an Idempotency-Key, new for each tap on "Pay". */
function requireIdempotencyKey(req, res, next) {
  const key = req.get('idempotency-key');
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
  req.idempotencyKey = key;
  next();
}

/** Mounted at /api/v1/payments */
const router = Router();

router.post(
  '/',
  authenticate,
  authorize('payment:create'),
  requireIdempotencyKey,
  validate({ body: schemas.pay }),
  controller.pay,
);
router.get(
  '/:id',
  authenticate,
  authorize.any('payment:create', 'payment:manage'),
  validate({ params: schemas.idParams }),
  controller.get,
);
router.post(
  '/:id/refund',
  authenticate,
  authorize('refund:create'),
  validate({ params: schemas.idParams, body: schemas.refund }),
  controller.refund,
);

module.exports = router;

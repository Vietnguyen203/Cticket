const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const { rateLimit, LIMITS } = require('../../middleware/rateLimit');
const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const schemas = require('./two-factor.schemas');
const twoFactor = require('./two-factor.service');
const { sendTokens } = require('./auth.controller');
const cookie = require('./refresh-cookie');
const trustedDevices = require('./trusted-devices');
const { pool } = require('../../database/pool');

/**
 * Mounted at /api/v1/users/me/2fa (Phase 15): the signed-in user's own
 * two-factor settings. Password / code checks are rate-limited per user.
 */
const router = Router();
router.use(authenticate);
const limited = rateLimit(LIMITS.twoFactor);

router.get('/', async (req, res) => sendSuccess(res, { twoFactor: await twoFactor.getStatus(req.user.id) }));

router.post('/setup', limited, validate({ body: schemas.startSetup }), async (req, res) =>
  sendSuccess(res, { setup: await twoFactor.startSetup(req.user.id, req.valid.body) }),
);

// Two-factor on: a new session replaces this one (other devices must log in again).
router.post('/confirm', limited, validate({ body: schemas.confirmSetup }), async (req, res) => {
  const { session, recoveryCodes } = await twoFactor.confirmSetup(req.user.id, req.valid.body, requestContext(req));
  return sendTokens(req, res, { ...session, recoveryCodes });
});

router.post('/disable', limited, validate({ body: schemas.disable }), async (req, res) => {
  await twoFactor.disable(req.user.id, req.valid.body);
  return sendSuccess(res, { twoFactor: await twoFactor.getStatus(req.user.id) });
});

router.post('/recovery-codes', limited, validate({ body: schemas.regenerateRecoveryCodes }), async (req, res) =>
  sendSuccess(res, await twoFactor.regenerateRecoveryCodes(req.user.id, req.valid.body)),
);

// "Ghi nhớ đăng nhập": the browsers that skip the code, and "Quên các thiết bị".
router.get('/trusted-devices', async (req, res) =>
  sendSuccess(res, { devices: await trustedDevices.listDevices(pool, req.user.id) }),
);
router.delete('/trusted-devices', async (req, res) => {
  await trustedDevices.forgetDevices(pool, req.user.id);
  if (cookie.usesCookie(req)) cookie.clearDeviceCookie(res);
  return sendSuccess(res, { devices: [] });
});

module.exports = router;

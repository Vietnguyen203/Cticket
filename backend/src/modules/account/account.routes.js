const { Router } = require('express');
const { z } = require('zod');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const { rateLimit, LIMITS } = require('../../middleware/rateLimit');
const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const account = require('./account.service');

/**
 * Mounted at /api/v1/users/me: the signed-in user's own personal data.
 * The deletion checks the password, rate-limited per user (as two-factor changes).
 */
// authenticate per route, not router.use: GET / PATCH /users/me pass through to the users router.
const router = Router();

// The file the user saves: everything ETP holds about them.
router.get('/data', authenticate, async (req, res) => {
  const data = await account.exportData(req.user.id);
  const day = data.exportedAt.slice(0, 10);
  res.set('Content-Disposition', `attachment; filename="etp-du-lieu-ca-nhan-${day}.json"`);
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, { data });
});

router.get('/deletion', authenticate, async (req, res) => sendSuccess(res, { deletion: await account.deletionCheck(req.user.id) }));

router.delete(
  '/',
  authenticate,
  rateLimit(LIMITS.twoFactor),
  validate({ body: z.object({ password: z.string().min(1).max(200) }) }),
  async (req, res) => sendSuccess(res, await account.deleteAccount(requestContext(req), req.user.id, req.valid.body)),
);

module.exports = router;

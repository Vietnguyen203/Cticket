const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const { rateLimit, LIMITS } = require('../../middleware/rateLimit');
const schemas = require('./auth.schemas');
const twoFactorSchemas = require('./two-factor.schemas');
const controller = require('./auth.controller');

const router = Router();

router.post('/register', rateLimit(LIMITS.register), validate({ body: schemas.register }), controller.register);
router.post('/otp', rateLimit(LIMITS.otpRequest), validate({ body: schemas.requestOtp }), controller.requestOtp);
router.post('/otp/verify', rateLimit(LIMITS.otpVerify), validate({ body: schemas.verifyOtp }), controller.verifyOtp);
router.post('/login', rateLimit(LIMITS.login), validate({ body: schemas.login }), controller.login);
// Phase 15: step 2 of a login with two-factor (the mfaToken from step 1 proves the password).
const loginTwoFactor = rateLimit(LIMITS.loginTwoFactor);
router.post('/login/2fa', loginTwoFactor, validate({ body: twoFactorSchemas.verifyLogin }), controller.verifyLoginTwoFactor);
router.post('/login/2fa/setup', loginTwoFactor, validate({ body: twoFactorSchemas.loginSetup }), controller.startLoginTwoFactorSetup);
router.post(
  '/login/2fa/setup/confirm',
  loginTwoFactor,
  validate({ body: twoFactorSchemas.confirmLoginSetup }),
  controller.confirmLoginTwoFactorSetup,
);
router.post('/refresh', rateLimit(LIMITS.refresh), validate({ body: schemas.refresh }), controller.refresh);
router.post('/logout', validate({ body: schemas.logout }), controller.logout);
router.get('/me', authenticate, controller.me);

module.exports = router;

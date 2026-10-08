const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const schemas = require('./auth.schemas');
const controller = require('./auth.controller');

const router = Router();

router.post('/register', validate({ body: schemas.register }), controller.register);
router.post('/otp', validate({ body: schemas.requestOtp }), controller.requestOtp);
router.post('/otp/verify', validate({ body: schemas.verifyOtp }), controller.verifyOtp);
router.post('/login', validate({ body: schemas.login }), controller.login);
router.post('/refresh', validate({ body: schemas.refresh }), controller.refresh);
router.post('/logout', validate({ body: schemas.logout }), controller.logout);
router.get('/me', authenticate, controller.me);

module.exports = router;

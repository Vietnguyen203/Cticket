const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const schemas = require('./users.schemas');
const controller = require('./users.controller');

/** Mounted at /api/v1/users */
const router = Router();

router.get('/me', authenticate, controller.getMe);
router.patch('/me', authenticate, validate({ body: schemas.updateProfile }), controller.updateMe);

module.exports = router;

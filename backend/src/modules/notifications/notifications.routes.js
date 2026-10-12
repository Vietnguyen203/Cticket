const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const schemas = require('./notifications.schemas');
const controller = require('./notifications.controller');

/** Mounted at /api/v1/notifications: every signed-in user, their own notifications only (NOT-01). */
const router = Router();

router.get('/', authenticate, validate({ query: schemas.listQuery }), controller.list);
router.post('/read-all', authenticate, controller.markAllRead);
router.patch('/:id/read', authenticate, validate({ params: schemas.idParams }), controller.markRead);

module.exports = router;

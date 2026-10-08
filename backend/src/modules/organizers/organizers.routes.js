const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./organizers.schemas');
const controller = require('./organizers.controller');

const router = Router();
const canManage = [authenticate, authorize('organizer:manage')];

// Any logged-in user may apply; their profile starts as PENDING.
router.post('/', authenticate, validate({ body: schemas.apply }), controller.apply);
router.get('/me', authenticate, controller.getMine);

router.get('/', ...canManage, validate({ query: schemas.listQuery }), controller.list);
router.patch(
  '/:id/status',
  ...canManage,
  validate({ params: schemas.idParams, body: schemas.changeStatus }),
  controller.changeStatus,
);

module.exports = router;

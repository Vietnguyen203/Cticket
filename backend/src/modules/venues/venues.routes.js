const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./venues.schemas');
const controller = require('./venues.controller');

const router = Router();
const canManage = [authenticate, authorize('venue:manage')];

router.get('/', authenticate.optional, validate({ query: schemas.listQuery }), controller.list);
router.get('/:id', authenticate.optional, validate({ params: schemas.idParams }), controller.get);
router.post('/', ...canManage, validate({ body: schemas.createVenue }), controller.create);
router.patch('/:id', ...canManage, validate({ params: schemas.idParams, body: schemas.updateVenue }), controller.update);

module.exports = router;

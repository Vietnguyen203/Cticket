const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./categories.schemas');
const controller = require('./categories.controller');

const router = Router();
const canManage = [authenticate, authorize('category:manage')];

router.get('/', controller.list);
router.get('/usage', ...canManage, controller.usage);
router.post('/', ...canManage, validate({ body: schemas.createCategory }), controller.create);
router.patch('/:id', ...canManage, validate({ params: schemas.idParams, body: schemas.updateCategory }), controller.update);
router.delete('/:id', ...canManage, validate({ params: schemas.idParams }), controller.remove);

module.exports = router;

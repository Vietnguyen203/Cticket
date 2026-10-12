const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./promotions.schemas');
const controller = require('./promotions.controller');

const canManage = [authenticate, authorize('promotion:manage')];

/** Mounted at /api/v1/promotions */
const router = Router();

// PRO-01: a customer checks a code on one of their orders before checkout.
router.post(
  '/validate',
  authenticate,
  authorize('booking:create'),
  validate({ body: schemas.validatePromotion }),
  controller.validatePromotion,
);

// PRO-02: admin management.
router.get('/', ...canManage, validate({ query: schemas.listQuery }), controller.list);
router.post('/', ...canManage, validate({ body: schemas.createPromotion }), controller.create);
router.patch('/:id', ...canManage, validate({ params: schemas.idParams, body: schemas.updatePromotion }), controller.update);

module.exports = router;

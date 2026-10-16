const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./tickets.schemas');
const controller = require('./tickets.controller');

/** Mounted at /api/v1/tickets: the signed-in user's own tickets only (TKT-01, TKT-02). */
const router = Router();
const canRead = [authenticate, authorize('ticket:read:own')];

router.get('/', ...canRead, validate({ query: schemas.listQuery }), controller.list);
router.get('/:id', ...canRead, validate({ params: schemas.idParams }), controller.get);
router.get('/:id/qr.png', ...canRead, validate({ params: schemas.idParams }), controller.qrPng);
router.get('/:id/ticket.pdf', ...canRead, validate({ params: schemas.idParams }), controller.ticketPdf); // Phase 20

/** Phase 20, mounted at /api/v1/orders: GET /orders/:id/tickets.pdf (the order's valid tickets). */
const orderTicketsRouter = Router();
orderTicketsRouter.get('/:id/tickets.pdf', ...canRead, validate({ params: schemas.idParams }), controller.orderPdf);

module.exports = router;
module.exports.orderTicketsRouter = orderTicketsRouter;

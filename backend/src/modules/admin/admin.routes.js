const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./admin.schemas');
const controller = require('./admin.controller');

/** Mounted at /api/v1/admin (Phase 12.3). */
const router = Router();
const canManageUsers = [authenticate, authorize('user:manage')];

router.get('/users', ...canManageUsers, validate({ query: schemas.listUsersQuery }), controller.listUsers);
router.patch('/users/:id/status', ...canManageUsers, validate({ params: schemas.idParams, body: schemas.changeUserStatus }), controller.changeUserStatus);
router.put('/users/:id/roles', ...canManageUsers, validate({ params: schemas.idParams, body: schemas.setUserRoles }), controller.setUserRoles);

router.get('/audit-logs', authenticate, authorize('audit:read'), validate({ query: schemas.listAuditQuery }), controller.listAuditLogs);
router.get('/audit-logs/actions', authenticate, authorize('audit:read'), controller.listAuditActions);

router.post('/tickets/:id/reissue-qr', authenticate, authorize('order:manage'), validate({ params: schemas.idParams }), controller.reissueQr);

module.exports = router;

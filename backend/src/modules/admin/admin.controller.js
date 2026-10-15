const { pool } = require('../../database/pool');
const { sendSuccess } = require('../../utils/response');
const { requestContext } = require('../../utils/requestContext');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const audit = require('../audit');
const tickets = require('../tickets');
const adminUsersService = require('./admin-users.service');

async function listUsers(req, res) {
  const { users, meta } = await adminUsersService.listUsers(req.valid.query);
  return sendSuccess(res, { users }, { meta });
}

async function changeUserStatus(req, res) {
  const user = await adminUsersService.changeStatus(requestContext(req), req.user.id, req.valid.params.id, req.valid.body);
  return sendSuccess(res, { user });
}

async function setUserRoles(req, res) {
  const user = await adminUsersService.setRoles(requestContext(req), req.user.id, req.valid.params.id, req.valid.body);
  return sendSuccess(res, { user });
}

async function resetUserTwoFactor(req, res) {
  const user = await adminUsersService.resetTwoFactor(requestContext(req), req.user.id, req.valid.params.id, req.valid.body);
  return sendSuccess(res, { user });
}

function toAuditLog(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldValue: row.old_value,
    newValue: row.new_value,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  };
}

/** AUD-02 (read only: the table refuses UPDATE / DELETE). */
async function listAuditLogs(req, res) {
  const { page, pageSize, ...filters } = req.valid.query;
  const { rows, total } = await audit.listAuditLogs(pool, { ...filters, ...toLimitOffset({ page, pageSize }) });
  return sendSuccess(res, { auditLogs: rows.map(toAuditLog) }, { meta: toPageMeta({ page, pageSize }, total) });
}

async function listAuditActions(req, res) {
  return sendSuccess(res, { actions: await audit.listAuditActions(pool) });
}

/** TKT-03 */
async function reissueQr(req, res) {
  return sendSuccess(res, { ticket: await tickets.reissueQr(requestContext(req), req.valid.params.id) });
}

async function unlockUserLogin(req, res) {
  return sendSuccess(res, { user: await adminUsersService.unlockLogin(requestContext(req), req.valid.params.id) });
}

module.exports = {
  listUsers,
  changeUserStatus,
  setUserRoles,
  resetUserTwoFactor,
  unlockUserLogin,
  listAuditLogs,
  listAuditActions,
  reissueQr,
};

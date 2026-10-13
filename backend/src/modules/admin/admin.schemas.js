const { z } = require('zod');
const { ROLES, USER_STATUS } = require('../../config/constants');
const { paginationQuery } = require('../../utils/pagination');
const { isoDateTime } = require('../../utils/schemas');

const idParams = z.object({ id: z.uuid() });

const listUsersQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  role: z.enum(Object.values(ROLES)).optional(),
  status: z.enum(Object.values(USER_STATUS)).optional(),
  ...paginationQuery,
});

const changeUserStatus = z
  .object({
    status: z.enum([USER_STATUS.ACTIVE, USER_STATUS.SUSPENDED]),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .refine((body) => body.status !== USER_STATUS.SUSPENDED || body.reason, {
    message: 'a reason is required to suspend an account',
    path: ['reason'],
  });

const setUserRoles = z.object({
  roles: z.array(z.enum(Object.values(ROLES))).max(Object.values(ROLES).length),
});

const listAuditQuery = z.object({
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.uuid().optional(),
  userId: z.uuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  ...paginationQuery,
});

module.exports = { idParams, listUsersQuery, changeUserStatus, setUserRoles, listAuditQuery };

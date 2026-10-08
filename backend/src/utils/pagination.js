const { z } = require('zod');
const { PAGINATION } = require('../config/constants');

/** Query fields shared by every paginated list: ?page=1&pageSize=20 */
const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGINATION.MAX_PAGE_SIZE).default(PAGINATION.DEFAULT_PAGE_SIZE),
};

function toLimitOffset({ page, pageSize }) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

function toPageMeta({ page, pageSize }, total) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/**
 * Escape LIKE wildcards in user input: searching for "50%" must match the
 * text "50%", not "50 followed by anything". Use with `LIKE ... ESCAPE '\'`.
 */
function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

module.exports = { paginationQuery, toLimitOffset, toPageMeta, escapeLike };

const MAX_USER_AGENT_LENGTH = 500;

/**
 * Who is calling and from where, for refresh tokens and audit logs.
 * Built in controllers so services never touch `req`.
 */
function requestContext(req) {
  return {
    userId: req.user?.id ?? null,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
  };
}

module.exports = { requestContext };

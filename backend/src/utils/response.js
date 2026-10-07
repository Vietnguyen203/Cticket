const HTTP_OK = 200;

/**
 * Send the standard success envelope: { success: true, data, meta? }.
 */
function sendSuccess(res, data, { status = HTTP_OK, meta } = {}) {
  const body = { success: true, data };
  if (meta !== undefined) {
    body.meta = meta;
  }
  return res.status(status).json(body);
}

module.exports = { sendSuccess };

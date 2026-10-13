const { sendSuccess } = require('../../utils/response');
const uploadsService = require('./uploads.service');

const HTTP_CREATED = 201;

/** Body = the raw bytes of the image (Content-Type image/jpeg, image/png or image/webp). */
async function uploadImage(req, res) {
  return sendSuccess(res, { image: await uploadsService.saveImage(req.body) }, { status: HTTP_CREATED });
}

module.exports = { uploadImage };

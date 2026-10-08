const { sendSuccess } = require('../../utils/response');
const categoriesService = require('./categories.service');

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

async function list(req, res) {
  return sendSuccess(res, { categories: await categoriesService.listCategories() });
}

async function create(req, res) {
  const category = await categoriesService.createCategory(req.valid.body);
  return sendSuccess(res, { category }, { status: HTTP_CREATED });
}

async function update(req, res) {
  const category = await categoriesService.updateCategory(req.valid.params.id, req.valid.body);
  return sendSuccess(res, { category });
}

async function remove(req, res) {
  await categoriesService.deleteCategory(req.valid.params.id);
  return res.status(HTTP_NO_CONTENT).end();
}

module.exports = { list, create, update, remove };

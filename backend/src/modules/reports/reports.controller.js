const { sendSuccess } = require('../../utils/response');
const reportsService = require('./reports.service');

async function eventSales(req, res) {
  return sendSuccess(res, await reportsService.eventSales(req.user, req.valid.params.id));
}

async function myEvents(req, res) {
  return sendSuccess(res, await reportsService.myEvents(req.user));
}

async function platformSales(req, res) {
  return sendSuccess(res, await reportsService.platformSales(req.valid.query));
}

async function overview(req, res) {
  return sendSuccess(res, await reportsService.overview());
}

module.exports = { eventSales, myEvents, platformSales, overview };

const { sendSuccess } = require('../../utils/response');
const ticketsService = require('./tickets.service');

async function list(req, res) {
  const { tickets, meta } = await ticketsService.listMine(req.user.id, req.valid.query);
  return sendSuccess(res, { tickets }, { meta });
}

async function get(req, res) {
  // The QR content is a bearer credential for the gate: never cache it.
  res.set('Cache-Control', 'no-store');
  return sendSuccess(res, { ticket: await ticketsService.getMine(req.user.id, req.valid.params.id) });
}

async function qrPng(req, res) {
  const png = await ticketsService.qrPngOfMine(req.user.id, req.valid.params.id);
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
  return res.send(png);
}

/** Phase 20: a PDF download (no cache: it holds the QR codes, bearer credentials for the gate). */
function sendPdf(res, { filename, pdf }) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  return res.send(pdf);
}

async function ticketPdf(req, res) {
  return sendPdf(res, await ticketsService.ticketPdfOfMine(req.user.id, req.valid.params.id));
}

async function orderPdf(req, res) {
  return sendPdf(res, await ticketsService.orderPdfOfMine(req.user.id, req.valid.params.id));
}

module.exports = { list, get, qrPng, ticketPdf, orderPdf };

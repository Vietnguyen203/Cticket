/** Public API of the tickets module (used by background jobs, the orders and the check-ins modules). */
const { issueTicketsForOrder, reconcileTickets, listForOrder, confirmationOf, toTicketView } = require('./tickets.service');
const ticketsRepository = require('./tickets.repository');
const { qrTokenHash, parseQrToken } = require('./qr');

module.exports = {
  issueTicketsForOrder,
  reconcileTickets,
  listForOrder,
  confirmationOf,
  toTicketView,
  parseQrToken,
  qrTokenHash,
  lockTicketForCheckIn: ticketsRepository.lockViewForCheckIn,
  markTicketUsed: ticketsRepository.markUsed,
};

/** Public API of the tickets module (used by background jobs and the orders module). */
const { issueTicketsForOrder, reconcileTickets, listForOrder, confirmationOf } = require('./tickets.service');

module.exports = { issueTicketsForOrder, reconcileTickets, listForOrder, confirmationOf };

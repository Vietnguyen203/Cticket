/** Public API of the payments module for other modules (event / schedule cancellation). */
const { refundPaidOrders } = require('./payments.service');
const vnpayService = require('./vnpay.service');

const refundPaidOrdersOfEvent = (client, eventId, options) => refundPaidOrders(client, { eventId }, options);
const refundPaidOrdersOfSchedule = (client, scheduleId, options) => refundPaidOrders(client, { scheduleId }, options);

module.exports = {
  refundPaidOrdersOfEvent,
  refundPaidOrdersOfSchedule,
  // Phase 17, for the worker
  reconcileGatewayPayments: vnpayService.reconcileAttempts,
  processVnpayRefund: vnpayService.processRefund,
  sendPaymentReturnedEmail: vnpayService.sendPaymentReturnedEmail,
};

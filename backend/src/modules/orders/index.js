/** Public API of the orders module for other modules and scripts. */
const {
  cancelHeldOrdersOfEvent,
  cancelHeldOrdersOfSchedule,
  releaseHeldOrder,
  expireOrder,
  expireDueOrders,
} = require('./order-release');
const {
  markOrderPaid,
  markPaymentFailed,
  refundPaidOrder,
  lockOrder,
  lockPaidOrders,
  PAYABLE,
} = require('./order-payment');
const { findInventoryMismatches, completeOrdersOfFinishedSchedules } = require('./orders.repository');
const { previewPromotion } = require('./orders.service');
const { summarizeEventSales, purgeEventSales } = require('./order-purge');

module.exports = {
  cancelHeldOrdersOfEvent,
  cancelHeldOrdersOfSchedule,
  releaseHeldOrder,
  expireOrder,
  expireDueOrders,
  completeOrdersOfFinishedSchedules,
  markOrderPaid,
  markPaymentFailed,
  refundPaidOrder,
  lockOrder,
  lockPaidOrders,
  PAYABLE_STATUSES: PAYABLE,
  findInventoryMismatches,
  previewPromotion,
  summarizeEventSales,
  purgeEventSales,
};

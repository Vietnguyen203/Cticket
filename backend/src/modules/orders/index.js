/** Public API of the orders module for other modules and scripts. */
const { cancelHeldOrdersOfEvent, cancelHeldOrdersOfSchedule, releaseHeldOrder } = require('./order-release');
const { markOrderPaid, markPaymentFailed, refundPaidOrder, lockOrder, lockPaidOrders, PAYABLE } = require('./order-payment');
const { findInventoryMismatches } = require('./orders.repository');
const { previewPromotion } = require('./orders.service');

module.exports = {
  cancelHeldOrdersOfEvent,
  cancelHeldOrdersOfSchedule,
  releaseHeldOrder,
  markOrderPaid,
  markPaymentFailed,
  refundPaidOrder,
  lockOrder,
  lockPaidOrders,
  PAYABLE_STATUSES: PAYABLE,
  findInventoryMismatches,
  previewPromotion,
};

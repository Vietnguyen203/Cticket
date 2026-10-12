/** Public API of the promotions module for other modules (the orders module, at checkout). */
const { preview, useForOrder, returnUsesOfOrder } = require('./promotions.service');

module.exports = { preview, useForOrder, returnUsesOfOrder };

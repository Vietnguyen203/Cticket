const env = require('../../config/env');
const logger = require('../../utils/logger');
const { expireDueOrders } = require('./order-release');

/**
 * Every ORDER_SWEEP_INTERVAL_SECONDS, expire HELD orders whose time is up.
 * Safe with several API instances (SKIP LOCKED). Started by server.js only,
 * so tests and scripts never run it in the background.
 * Phase 9 replaces this with a delayed BullMQ job per order.
 *
 * @returns {{ stop: () => Promise<void> }} stop() waits for a sweep in progress
 */
function startOrderSweeper({ intervalMs = env.ORDER_SWEEP_INTERVAL_SECONDS * 1000 } = {}) {
  let running = null;

  const sweep = async () => {
    try {
      const expired = await expireDueOrders();
      if (expired > 0) logger.info({ expired }, 'Expired held orders');
    } catch (err) {
      logger.error({ err }, 'Order sweep failed');
    }
  };

  const timer = setInterval(() => {
    if (running) return; // the previous sweep is still busy
    running = sweep().finally(() => {
      running = null;
    });
  }, intervalMs);
  timer.unref();

  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}

module.exports = { startOrderSweeper };

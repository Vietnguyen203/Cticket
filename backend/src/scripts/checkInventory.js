const logger = require('../utils/logger');
const { pool, closePool } = require('../database/pool');
const { findInventoryMismatches } = require('../modules/orders');

/**
 * Recount inventory from orders and compare it with the stored counters and
 * seat statuses. Prints every mismatch; exit code 1 if there is any.
 * Run after load tests (Phase 13) or whenever stock looks wrong:
 *   npm run inventory:check
 */
async function checkInventory() {
  const mismatches = await findInventoryMismatches(pool);
  for (const mismatch of mismatches) {
    logger.error(mismatch, 'Inventory mismatch');
  }
  return mismatches;
}

if (require.main === module) {
  checkInventory()
    .then((mismatches) => {
      if (mismatches.length > 0) {
        process.exitCode = 1;
      } else {
        logger.info('Inventory is consistent with orders');
      }
    })
    .catch((err) => {
      logger.error({ err }, 'Inventory check failed');
      process.exitCode = 1;
    })
    .finally(() => closePool());
}

module.exports = { checkInventory };

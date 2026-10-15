const { REFUND_POLICY_TIERS } = require('../../config/constants');

const HOUR_MS = 60 * 60 * 1000;

/**
 * Phase 18.3: what a customer gets back for cancelling now, under the event's
 * policy. Pure (no database): the API, the tests and the preview agree.
 *
 * Tiers go from the earliest: cancelling at least `hoursBefore` the show
 * refunds `percent` of what was paid, rounded down to the đồng; the rest is
 * the cancellation fee the organizer keeps.
 *
 * @param {{ policy: string, startAt: Date|string, paidAmount: number, now?: Date }} input
 * @returns {{ allowed: false, reason: 'NO_REFUND_POLICY'|'TOO_LATE' }
 *   | { allowed: true, percent: number, refundAmount: number, fee: number, tierEndsAt: Date }}
 */
function refundTerms({ policy, startAt, paidAmount, now = new Date() }) {
  const tiers = REFUND_POLICY_TIERS[policy] ?? [];
  if (tiers.length === 0) return { allowed: false, reason: 'NO_REFUND_POLICY' };
  const start = new Date(startAt).getTime();
  const tier = tiers.find((t) => start - now.getTime() >= t.hoursBefore * HOUR_MS);
  if (!tier) return { allowed: false, reason: 'TOO_LATE' };
  const refundAmount = Math.floor((paidAmount * tier.percent) / 100);
  return {
    allowed: true,
    percent: tier.percent,
    refundAmount,
    fee: paidAmount - refundAmount,
    // After this moment the next (smaller) tier applies, or no cancelling at all.
    tierEndsAt: new Date(start - tier.hoursBefore * HOUR_MS),
  };
}

module.exports = { refundTerms };

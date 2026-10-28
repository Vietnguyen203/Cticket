const { MONITORING } = require('../../config/constants');

/**
 * Request latencies kept as counts per bucket (MONITORING.LATENCY_BUCKETS_MS,
 * then one bucket for anything slower), so counts from many processes and
 * many minutes simply add up. A percentile comes back as the upper bound of
 * its bucket: precise to one bucket, enough to see "much slower than usual".
 */
const BOUNDS = MONITORING.LATENCY_BUCKETS_MS;
const BUCKETS = BOUNDS.length + 1;
// Reported for the last bucket ("slower than 5 s"): the web shows it as "> 5 s".
const OVER_MS = BOUNDS.at(-1) + 1;

/** Index of the bucket a duration falls in. */
function bucketOf(ms) {
  const index = BOUNDS.findIndex((bound) => ms <= bound);
  return index === -1 ? BOUNDS.length : index;
}

const emptyBuckets = () => new Array(BUCKETS).fill(0);

/** @param {number[]} into  summed in place */
function addBuckets(into, buckets) {
  for (let i = 0; i < BUCKETS; i += 1) into[i] += buckets[i] ?? 0;
  return into;
}

/**
 * The p-th percentile (0 < p ≤ 100) of the counts, in ms; null without data.
 * @param {number[]} buckets
 */
function percentile(buckets, p) {
  const total = buckets.reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;
  const rank = Math.ceil((p / 100) * total);
  let seen = 0;
  for (let i = 0; i < BUCKETS; i += 1) {
    seen += buckets[i];
    if (seen >= rank) return i < BOUNDS.length ? BOUNDS[i] : OVER_MS;
  }
  return OVER_MS;
}

module.exports = { BUCKETS, OVER_MS, bucketOf, emptyBuckets, addBuckets, percentile };

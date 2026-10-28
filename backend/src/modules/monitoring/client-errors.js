const { createHash } = require('node:crypto');
const { MONITORING } = require('../../config/constants');
const { redis, tryRedis } = require('../../redis/client');
const { count } = require('./metrics');

/**
 * Phase 23: JavaScript errors reported by the web (POST /client-errors),
 * grouped by fingerprint (the message and the first line of the stack):
 *   monitor:ce:<fingerprint>  hash: message, stack, page, browser, release, count, firstSeen, lastSeen
 *   monitor:ce:index          sorted set fingerprint → lastSeen
 * Kept MONITORING.HISTORY_DAYS, at most MONITORING.HISTORY_MAX groups.
 * Nothing personal is stored: no user, no IP, the page without its query string.
 */
const INDEX_KEY = 'monitor:ce:index';
const groupKey = (fingerprint) => `monitor:ce:${fingerprint}`;
const KEEP_SECONDS = MONITORING.HISTORY_DAYS * 24 * 60 * 60;

/** The first stack line that is not the message itself (browsers repeat it on line 1). */
function firstFrame(stack) {
  return (stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('at ') || line.includes('@')) ?? '';
}

function fingerprintOf({ message, stack }) {
  return createHash('sha1').update(`${message}\n${firstFrame(stack)}`).digest('hex').slice(0, 16);
}

/** Store one report. Redis down: dropped (the web does not retry). */
async function recordClientError(report, now = Date.now()) {
  count('ce', 1, now);
  const fingerprint = fingerprintOf(report);
  const key = groupKey(fingerprint);
  await tryRedis(
    'client error',
    async () => {
      await redis
        .multi()
        .hsetnx(key, 'firstSeen', String(now))
        .hset(key, {
          message: report.message,
          stack: report.stack ?? '',
          page: report.page,
          browser: report.browser ?? '',
          release: report.release ?? '',
          lastSeen: String(now),
        })
        .hincrby(key, 'count', 1)
        .expire(key, KEEP_SECONDS)
        .zadd(INDEX_KEY, now, fingerprint)
        .zremrangebyscore(INDEX_KEY, '-inf', now - KEEP_SECONDS * 1000)
        .zremrangebyrank(INDEX_KEY, 0, -(MONITORING.HISTORY_MAX + 1))
        .expire(INDEX_KEY, KEEP_SECONDS)
        .exec();
    },
    null,
  );
  return fingerprint;
}

/** The groups, last seen first. */
async function listClientErrors(limit = 50) {
  const fingerprints = await redis.zrevrange(INDEX_KEY, 0, limit - 1);
  if (fingerprints.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const fingerprint of fingerprints) pipeline.hgetall(groupKey(fingerprint));
  const results = await pipeline.exec();
  return fingerprints
    .map((fingerprint, i) => {
      const group = results[i][1];
      if (!group || !group.message) return null;
      return {
        fingerprint,
        message: group.message,
        stack: group.stack || null,
        page: group.page,
        browser: group.browser || null,
        release: group.release || null,
        count: Number(group.count),
        firstSeenAt: new Date(Number(group.firstSeen)).toISOString(),
        lastSeenAt: new Date(Number(group.lastSeen)).toISOString(),
      };
    })
    .filter(Boolean);
}

module.exports = { recordClientError, listClientErrors, fingerprintOf };

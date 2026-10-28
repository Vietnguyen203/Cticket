const { bucketOf, emptyBuckets, percentile, OVER_MS } = require('../../src/modules/monitoring/histogram');
const { summarize, slowestRoutes } = require('../../src/modules/monitoring/system-status');
const { RULES } = require('../../src/modules/monitoring/alerts');
const { fingerprintOf } = require('../../src/modules/monitoring/client-errors');
const { clientError } = require('../../src/modules/monitoring/monitoring.schemas');
const { routeOf } = require('../../src/modules/monitoring/metrics');

/** Phase 23: the pure parts of system monitoring. */
describe('latency histogram', () => {
  test('a duration falls in the first bucket that holds it; slower than 5 s in the last', () => {
    expect(bucketOf(3)).toBe(0);
    expect(bucketOf(25)).toBe(0);
    expect(bucketOf(26)).toBe(1);
    expect(bucketOf(1000)).toBe(5);
    expect(bucketOf(5000)).toBe(7);
    expect(bucketOf(90_000)).toBe(8);
  });

  test('p50 / p95 are the upper bound of their bucket; none without data', () => {
    expect(percentile(emptyBuckets(), 95)).toBeNull();
    const buckets = emptyBuckets();
    buckets[1] = 90; // ≤ 50 ms
    buckets[5] = 10; // ≤ 1 s
    expect(percentile(buckets, 50)).toBe(50);
    expect(percentile(buckets, 90)).toBe(50);
    expect(percentile(buckets, 95)).toBe(1000);
    buckets[8] = 100;
    expect(percentile(buckets, 95)).toBe(OVER_MS);
  });
});

describe('request figures', () => {
  test('minutes add up; error rate, routes and the slowest routes', () => {
    const minute = (n, s5, slowRoute) => ({
      fields: { n, s5, s4: 1, b1: n - 1, b6: 1, [`r|${slowRoute}|n`]: 6, [`r|${slowRoute}|b6`]: 6, 'r|GET /fast|n': 10, 'r|GET /fast|b0': 10 },
    });
    const summary = summarize([minute(50, 1, 'GET /slow'), minute(50, 4, 'GET /slow')]);
    expect(summary).toMatchObject({ requests: 100, serverErrors: 5, clientErrors4xx: 2, errorRatePercent: 5, p50Ms: 50 });
    expect(slowestRoutes(summary.routes)).toEqual([
      { route: 'GET /slow', requests: 12, p95Ms: 2500 },
      { route: 'GET /fast', requests: 20, p95Ms: 25 },
    ]);
    // Too few requests to judge a route.
    expect(slowestRoutes(summarize([{ fields: { 'r|GET /once|n': 1, 'r|GET /once|b8': 1 } }]).routes)).toEqual([]);
  });

  test('a route is named by its pattern, never by the ids in the URL', () => {
    expect(routeOf({ method: 'GET', baseUrl: '/api/v1/events', route: { path: '/:idOrSlug' } })).toBe('GET /api/v1/events/:idOrSlug');
    expect(routeOf({ method: 'POST', baseUrl: '/api/v1/client-errors', route: { path: '/' } })).toBe('POST /api/v1/client-errors');
    expect(routeOf({ method: 'GET', baseUrl: '', route: undefined })).toBeNull();
  });
});

describe('alert rules', () => {
  const healthy = {
    api: { windowMinutes: 5, requests: 200, serverErrors: 0, errorRatePercent: 0, p95Ms: 100 },
    database: { up: true },
    redis: { up: true },
    worker: { mode: 'bullmq', alive: true },
    queues: [{ name: 'emails', waiting: 3, oldestWaitingMs: 1000 }],
    failedJobsLastHour: 0,
    business: { refundsFailed: 0, refundsPendingTooLong: 0 },
    disk: { freePercent: 60, freeGb: 30 },
    webErrors: { windowMinutes: 10, count: 0 },
  };
  const firing = (status) => RULES.filter((rule) => rule.check(status)).map((rule) => rule.key);

  test('a healthy system raises nothing', () => {
    expect(firing(healthy)).toEqual([]);
  });

  test('each threshold, just over and just under', () => {
    const at = (changes) => firing({ ...healthy, ...changes });
    expect(at({ api: { ...healthy.api, serverErrors: 11, errorRatePercent: 5.5 } })).toEqual(['api-errors']);
    expect(at({ api: { ...healthy.api, serverErrors: 10, errorRatePercent: 5 } })).toEqual([]);
    // Too few requests: 1 error out of 3 is not an alert.
    expect(at({ api: { ...healthy.api, requests: 3, serverErrors: 1, errorRatePercent: 33.3 } })).toEqual([]);
    expect(at({ api: { ...healthy.api, p95Ms: 2500 } })).toEqual(['api-slow']);
    expect(at({ database: { up: false } })).toEqual(['database-down']);
    expect(at({ redis: { up: false } })).toEqual(['redis-down']);
    expect(at({ worker: { mode: 'bullmq', alive: false, lastSeenAt: null } })).toEqual(['worker-down']);
    expect(at({ worker: { mode: 'inline', alive: true } })).toEqual([]);
    expect(at({ queues: [{ name: 'emails', waiting: 501, oldestWaitingMs: 0 }] })).toEqual(['queue-backlog']);
    expect(at({ queues: [{ name: 'emails', waiting: 1, oldestWaitingMs: 6 * 60_000 }] })).toEqual(['queue-backlog']);
    expect(at({ failedJobsLastHour: 11 })).toEqual(['jobs-failed']);
    expect(at({ failedJobsLastHour: 10 })).toEqual([]);
    expect(at({ business: { refundsFailed: 1, refundsPendingTooLong: 0 } })).toEqual(['refunds-stuck']);
    expect(at({ disk: { freePercent: 9.5, freeGb: 2 } })).toEqual(['disk-low']);
    expect(at({ webErrors: { windowMinutes: 10, count: 51 } })).toEqual(['web-errors']);
  });

  test('a figure that could not be read raises nothing by itself', () => {
    expect(firing({ ...healthy, api: null, queues: null, business: null, disk: null, webErrors: null, failedJobsLastHour: null })).toEqual([]);
  });
});

describe('web errors', () => {
  test('the same error from another page or browser is one group', () => {
    const stack = 'TypeError: x is undefined\n    at render (index-abc.js:1:2)\n    at other (index-abc.js:3:4)';
    const a = fingerprintOf({ message: 'x is undefined', stack });
    expect(fingerprintOf({ message: 'x is undefined', stack: stack.replace('other', 'elsewhere') })).toBe(a);
    expect(fingerprintOf({ message: 'y is undefined', stack })).not.toBe(a);
  });

  test('the page keeps no query string or hash; text is cut and cleaned', () => {
    const parsed = clientError.parse({
      message: `  Boom\u0000${'x'.repeat(600)}`,
      page: '/orders/abc?token=secret#top',
      stack: 'at f (a.js:1:1)',
    });
    expect(parsed.page).toBe('/orders/abc');
    expect(parsed.message).toHaveLength(500);
    expect(parsed.message.startsWith('Boomx')).toBe(true);
    expect(clientError.safeParse({ message: 'x', page: 'https://evil.example/x' }).success).toBe(false);
    expect(clientError.safeParse({ message: '   ', page: '/' }).success).toBe(false);
  });
});

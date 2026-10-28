const request = require('supertest');
const { createApp } = require('../../src/app');
const { closePool } = require('../../src/database/pool');
const { redis, KEY_PREFIX } = require('../../src/redis/client');
const { setRateLimitEnabled } = require('../../src/middleware/rateLimit');
const { setQueueMode } = require('../../src/queue/queues');
const categoriesService = require('../../src/modules/categories/categories.service');
const metrics = require('../../src/modules/monitoring/metrics');
const { collectStatus, beat, HEARTBEAT_KEY } = require('../../src/modules/monitoring/system-status');
const alerts = require('../../src/modules/monitoring/alerts');
const { useFakeMailbox, createLoggedInUser } = require('../helpers/auth');
const { bearer, createAdmin } = require('../helpers/catalog');

/** Phase 23: system monitoring (docs/phase-23-monitoring-design.md). */
const app = createApp();
app.set('trust proxy', true); // the client-error limit is per IP: each test sends its own
const mailbox = useFakeMailbox();

let admin;
let customer;
let customerToken;

beforeAll(async () => {
  admin = await createAdmin(app);
  customer = await createLoggedInUser(app, mailbox);
  customerToken = customer.session.accessToken;
});
afterAll(() => closePool());

/** Delete keys by pattern (KEYS returns them with the prefix; DEL adds it again). */
async function clearKeys(pattern) {
  const keys = await redis.keys(`${KEY_PREFIX}${pattern}`);
  if (keys.length > 0) await redis.del(...keys.map((key) => key.slice(KEY_PREFIX.length)));
}

beforeEach(async () => {
  await metrics.flushMetrics(); // drop what earlier tests counted
  await clearKeys('metrics:*');
  await clearKeys('monitor:*');
  await alerts.resetAlerts();
  alerts.setAlertEmails([]);
});
afterEach(() => {
  setRateLimitEnabled(false);
  setQueueMode('inline');
});

const systemStatus = (token = admin.token) => request(app).get('/api/v1/admin/system').set(bearer(token));
const newIp = () => `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;
const reportError = (body, ip = newIp()) => request(app).post('/api/v1/client-errors').set('X-Forwarded-For', ip).send(body);

describe('request figures', () => {
  test('requests are counted by status and route; /health is not', async () => {
    await request(app).get('/api/v1/categories').expect(200);
    await request(app).get('/api/v1/categories').expect(200);
    await request(app).get('/api/v1/events/khong-co-su-kien-nay').expect(404);
    await request(app).get('/api/v1/khong-co-duong-nay').expect(404);
    await request(app).get('/health/live').expect(200);
    const breakdown = jest.spyOn(categoriesService, 'listCategories').mockRejectedValueOnce(new Error('boom'));
    await request(app).get('/api/v1/categories').expect(500);
    breakdown.mockRestore();
    await metrics.flushMetrics();

    const [minute] = (await metrics.readMinutes(1)).slice(-1);
    expect(minute.fields).toMatchObject({ n: 5, s2: 2, s4: 2, s5: 1 });
    expect(minute.fields['r|GET /api/v1/categories|n']).toBe(3);
    // The id in the URL is not part of the name.
    expect(minute.fields['r|GET /api/v1/events/:idOrSlug|n']).toBe(1);
    expect(Object.keys(minute.fields).some((field) => field.includes('khong-co'))).toBe(false);
  });

  test('two API processes pushing at once add up', async () => {
    // A second copy of the module (and of its Redis connection): another process.
    let other;
    let otherRedis;
    jest.isolateModules(() => {
      other = require('../../src/modules/monitoring/metrics');
      otherRedis = require('../../src/redis/client');
    });
    for (let i = 0; i < 7; i += 1) other.count('n');
    metrics.count('n', 5);
    await Promise.all([other.flushMetrics(), metrics.flushMetrics()]);
    await otherRedis.closeRedis();
    const rows = await metrics.readMinutes(2);
    expect(rows.reduce((sum, row) => sum + (row.fields.n ?? 0), 0)).toBe(12);
  });

  test('rate-limited requests are counted as 429', async () => {
    setRateLimitEnabled(true);
    const ip = newIp();
    for (let i = 0; i < 31; i += 1) await reportError({ message: `Lỗi ${i}`, page: '/' }, ip);
    await metrics.flushMetrics();
    const [minute] = (await metrics.readMinutes(1)).slice(-1);
    expect(minute.fields.s429).toBe(1);
  });
});

describe('the system page', () => {
  test('only people with system:monitor see it', async () => {
    await request(app).get('/api/v1/admin/system').expect(401);
    await systemStatus(customerToken).expect(403);
    await request(app).get('/api/v1/admin/system/series').set(bearer(customerToken)).expect(403);
  });

  test('the snapshot: requests, dependencies, queues, business figures, disk', async () => {
    for (let i = 0; i < 3; i += 1) await request(app).get('/api/v1/categories').expect(200);
    await metrics.flushMetrics();
    const res = await systemStatus().expect(200);
    const { status, alerts: list } = res.body.data;
    expect(status.api).toMatchObject({ windowMinutes: 5, requests: 3, serverErrors: 0, errorRatePercent: 0 });
    expect(status.api.p95Ms).toBeGreaterThan(0);
    expect(status.database).toMatchObject({ up: true });
    expect(status.redis).toMatchObject({ up: true });
    expect(status.worker).toMatchObject({ mode: 'inline', alive: true });
    expect(status.queues.map((q) => q.name)).toEqual(expect.arrayContaining(['tickets', 'emails', 'payments']));
    expect(status.business).toEqual(
      expect.objectContaining({ paymentsFailedLastHour: expect.any(Number), refundsFailed: expect.any(Number), ordersStuck: expect.any(Number) }),
    );
    expect(status.disk.freePercent).toBeGreaterThan(0);
    expect(list).toEqual({ active: [], history: [] });
  });

  test('the chart series: one point per minute', async () => {
    await request(app).get('/api/v1/categories').expect(200);
    await metrics.flushMetrics();
    const res = await request(app).get('/api/v1/admin/system/series?minutes=30').set(bearer(admin.token)).expect(200);
    expect(res.body.data.series).toHaveLength(30);
    expect(res.body.data.series.at(-1)).toMatchObject({ requests: 1, serverErrors: 0 });
    await request(app).get('/api/v1/admin/system/series?minutes=99999').set(bearer(admin.token)).expect(400);
  });

  test('Redis down: the page still answers, figures it could not read are empty', async () => {
    const broken = ['pipeline', 'ping', 'get', 'hgetall', 'lrange'].map((command) =>
      jest.spyOn(redis, command).mockImplementation(() => {
        throw new Error('Connection is closed.');
      }),
    );
    try {
      await expect(metrics.flushMetrics()).resolves.toBeUndefined();
      const res = await systemStatus().expect(200);
      expect(res.body.data.status).toMatchObject({ api: null, redis: { up: false }, database: { up: true } });
    } finally {
      broken.forEach((spy) => spy.mockRestore());
    }
  });
});

describe('alerts', () => {
  /**
   * The real figures of this machine and test database, made healthy where
   * they depend on things the tests do not control (this disk, refunds left
   * FAILED by the VNPay tests…).
   */
  async function healthyStatus(now) {
    const status = await collectStatus({ now });
    return {
      ...status,
      queues: status.queues.map((q) => ({ ...q, waiting: 0, oldestWaitingMs: null })),
      failedJobsLastHour: 0,
      business: { ...status.business, refundsFailed: 0, refundsPendingTooLong: 0 },
      disk: { freePercent: 50, freeGb: 50, totalGb: 100 },
      webErrors: { windowMinutes: 10, count: 0 },
    };
  }

  test('5xx over the threshold: one email, reminded after 30 minutes, then "over"', async () => {
    alerts.setAlertEmails(['truc-he-thong@example.com']);
    const now = Date.now();
    const status = await healthyStatus(now);
    const bad = { ...status, api: { ...status.api, requests: 100, serverErrors: 20, errorRatePercent: 20 } };

    expect(await alerts.runAlertCheck({ now, status: bad })).toEqual([{ key: 'api-errors', kind: 'FIRING' }]);
    expect(mailbox.subjects(admin.email)).toEqual(['[ETP] Cảnh báo: Tỉ lệ lỗi máy chủ (5xx) cao']);
    expect(mailbox.subjects('truc-he-thong@example.com')).toHaveLength(1);
    expect(mailbox.latestText(admin.email)).toContain('20% request lỗi 5xx');
    // A customer is never told.
    expect(mailbox.count(customer.email)).toBe(0);

    expect(await alerts.runAlertCheck({ now: now + 60_000, status: bad })).toEqual([]);
    expect(await alerts.runAlertCheck({ now: now + 31 * 60_000, status: bad })).toEqual([{ key: 'api-errors', kind: 'REMINDER' }]);
    expect((await systemStatus().expect(200)).body.data.alerts.active).toEqual([
      expect.objectContaining({ key: 'api-errors', title: 'Tỉ lệ lỗi máy chủ (5xx) cao' }),
    ]);

    expect(await alerts.runAlertCheck({ now: now + 32 * 60_000, status })).toEqual([{ key: 'api-errors', kind: 'RESOLVED' }]);
    expect(mailbox.subjects(admin.email)).toEqual([
      '[ETP] Cảnh báo: Tỉ lệ lỗi máy chủ (5xx) cao',
      '[ETP] Vẫn còn: Tỉ lệ lỗi máy chủ (5xx) cao',
      '[ETP] Đã hết: Tỉ lệ lỗi máy chủ (5xx) cao',
    ]);
    const { history } = (await systemStatus().expect(200)).body.data.alerts;
    expect(history.map((entry) => entry.status)).toEqual(['RESOLVED', 'FIRING']);
  });

  test('the database must fail two checks in a row', async () => {
    const now = Date.now();
    const status = await healthyStatus(now);
    const down = { ...status, database: { up: false } };
    expect(await alerts.runAlertCheck({ now, status: down })).toEqual([]);
    expect(await alerts.runAlertCheck({ now: now + 60_000, status: down })).toEqual([{ key: 'database-down', kind: 'FIRING' }]);
    // A single failure between two good checks is forgotten.
    expect(await alerts.runAlertCheck({ now: now + 120_000, status })).toEqual([{ key: 'database-down', kind: 'RESOLVED' }]);
    expect(await alerts.runAlertCheck({ now: now + 180_000, status: down })).toEqual([]);
  });

  test('the worker without a heartbeat is reported, even with no job running', async () => {
    setQueueMode('bullmq');
    await redis.del(HEARTBEAT_KEY);
    const now = Date.now();
    const silent = await healthyStatus(now);
    expect(silent.worker).toMatchObject({ mode: 'bullmq', alive: false, lastSeenAt: null });
    expect(await alerts.runAlertCheck({ now, status: silent })).toContainEqual({ key: 'worker-down', kind: 'FIRING' });
    expect(mailbox.subjects(admin.email)).toContain('[ETP] Cảnh báo: Worker không chạy');

    await beat(now + 60_000);
    const back = await healthyStatus(now + 61_000);
    expect(back.worker).toMatchObject({ alive: true });
    expect(await alerts.runAlertCheck({ now: now + 61_000, status: back })).toContainEqual({ key: 'worker-down', kind: 'RESOLVED' });
  });
});

describe('JavaScript errors of the web', () => {
  const error = { message: "Cannot read properties of undefined (reading 'price')", stack: 'TypeError: …\n    at Seat (SeatMap-abc.js:10:5)', page: '/events/abc?ref=mail', browser: 'Chrome 140', release: 'ce0a4b2' };

  test('stored without the query string, the same error grouped, listed for admins', async () => {
    await reportError(error).expect(202);
    await reportError({ ...error, page: '/events/xyz' }).expect(202);
    await reportError({ ...error, message: 'Another one' }).expect(202);
    await metrics.flushMetrics();

    const res = await request(app).get('/api/v1/admin/system/client-errors').set(bearer(admin.token)).expect(200);
    const [latest, grouped] = res.body.data.errors;
    expect(latest).toMatchObject({ message: 'Another one', count: 1 });
    expect(grouped).toMatchObject({ message: error.message, count: 2, page: '/events/xyz', browser: 'Chrome 140', release: 'ce0a4b2' });
    expect(JSON.stringify(res.body)).not.toContain('ref=mail');
    expect((await systemStatus().expect(200)).body.data.status.webErrors).toEqual({ windowMinutes: 10, count: 3 });
    await request(app).get('/api/v1/admin/system/client-errors').set(bearer(customerToken)).expect(403);
  });

  test('bad reports are refused; no login needed; over 30 a minute → 429', async () => {
    await reportError({ message: '', page: '/' }).expect(400);
    await reportError({ message: 'x', page: 'https://evil.example/' }).expect(400);
    setRateLimitEnabled(true);
    const ip = newIp();
    for (let i = 0; i < 30; i += 1) await reportError({ message: `Lỗi ${i}`, page: '/' }, ip).expect(202);
    const refused = await reportError({ message: 'Lỗi 31', page: '/' }, ip).expect(429);
    expect(refused.body.error.code).toBe('RATE_LIMITED');
  });
});

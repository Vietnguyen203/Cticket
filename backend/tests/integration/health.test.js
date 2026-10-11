const request = require('supertest');
const { createApp } = require('../../src/app');
const { redis } = require('../../src/redis/client');
const { closePool } = require('../../src/database/pool');

const app = createApp();

afterAll(() => closePool());

describe('health endpoints', () => {
  test('GET /health/live returns the success envelope', async () => {
    const res = await request(app).get('/health/live').expect(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  test('GET /health/ready reports the database and Redis as up', async () => {
    const res = await request(app).get('/health/ready').expect(200);
    expect(res.body.data).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  test('without Redis the API is degraded but still ready (only PostgreSQL is required)', async () => {
    const ping = jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('Connection is closed.'));
    const res = await request(app).get('/health/ready').expect(200);
    expect(res.body.data).toEqual({ status: 'degraded', checks: { database: 'up', redis: 'down' } });
    ping.mockRestore();
  });

  test('echoes a safe X-Request-Id and replaces an unsafe one', async () => {
    const safe = await request(app).get('/health/live').set('X-Request-Id', 'abc-123');
    expect(safe.headers['x-request-id']).toBe('abc-123');

    for (const unsafeId of ['bad id <script>', 'x'.repeat(65)]) {
      const res = await request(app).get('/health/live').set('X-Request-Id', unsafeId);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  test('sets security headers (helmet)', async () => {
    const res = await request(app).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('error envelope', () => {
  test('unknown route → 404 NOT_FOUND', async () => {
    const res = await request(app).get('/does-not-exist').expect(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });

  test('malformed JSON → 400 MALFORMED_JSON', async () => {
    const res = await request(app)
      .post('/health/live')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });
});

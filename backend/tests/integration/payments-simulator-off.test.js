// Phase 17: as in production, where the simulator is off by default.
// tests/setup/afterEnv.js has already loaded the configuration: load the
// modules again so src/config/env.js reads this value.
process.env.PAYMENT_SIMULATOR = 'false';
jest.resetModules();

const request = require('supertest');
const { createApp } = require('../../src/app');
const { closePool } = require('../../src/database/pool');
const { closeRedis } = require('../../src/redis/client');
const { closeQueues } = require('../../src/queue/queues');
const { bearer } = require('../helpers/catalog');
const { createCustomers } = require('../helpers/orders');

const app = createApp();

afterAll(async () => {
  await closeQueues();
  await closeRedis();
  await closePool();
});

test('the simulator off: only VNPay is offered, and POST /payments is refused', async () => {
  const methods = await request(app).get('/api/v1/payments/methods').expect(200);
  expect(methods.body.data.methods).toEqual(['VNPAY']);

  const [buyer] = await createCustomers(1);
  const res = await request(app)
    .post('/api/v1/payments')
    .set(bearer(buyer.token))
    .set('Idempotency-Key', 'simulator-off-test-key')
    .send({ orderId: '00000000-0000-4000-8000-000000000000' })
    .expect(403);
  expect(res.body.error.code).toBe('PAYMENT_METHOD_DISABLED');
});

const request = require('supertest');
const { query } = require('../../src/database/pool');
const { signAccessToken } = require('../../src/modules/auth/auth.tokens');
const { bearer } = require('./catalog');

/**
 * N active CUSTOMER accounts with access tokens, created straight in the
 * database. The register → OTP → login path is covered by the auth tests;
 * here it would only slow down the 50-user concurrency tests.
 * @returns {Promise<Array<{ id: string, token: string }>>}
 */
async function createCustomers(count) {
  const { rows } = await query(
    `WITH new_users AS (
       INSERT INTO users (email, password_hash, first_name, last_name, status, email_verified_at)
       SELECT 'buyer-' || gen_random_uuid() || '@example.com', 'not-a-real-hash', 'Test', 'Buyer', 'ACTIVE', now()
       FROM generate_series(1, $1)
       RETURNING id
     ), with_role AS (
       INSERT INTO user_roles (user_id, role_id)
       SELECT nu.id, r.id FROM new_users nu CROSS JOIN roles r WHERE r.code = 'CUSTOMER'
       RETURNING user_id
     )
     SELECT user_id AS id FROM with_role`,
    [count],
  );
  return rows.map(({ id }) => ({ id, token: signAccessToken({ id, roles: ['CUSTOMER'] }).accessToken }));
}

function book(app, token, scheduleId, body) {
  return request(app).post(`/api/v1/schedules/${scheduleId}/orders`).set(bearer(token)).send(body);
}

function cancelOrder(app, token, orderId) {
  return request(app).post(`/api/v1/orders/${orderId}/cancel`).set(bearer(token));
}

/** Move an order's deadline into the past (instead of waiting 10 minutes). */
async function makeDue(orderId) {
  await query(`UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1`, [orderId]);
  await query(`UPDATE schedule_seats SET hold_expires_at = now() - interval '1 second' WHERE held_by_order_id = $1`, [
    orderId,
  ]);
}

module.exports = { createCustomers, book, cancelOrder, makeDue };

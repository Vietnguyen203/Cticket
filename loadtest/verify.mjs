/**
 * After a k6 run: is the data still right? (TEST-03 correctness part)
 *
 *   node loadtest/verify.mjs
 *
 *  - no seat line of two open / paid orders on the same seat (no double sale)
 *  - the inventory adds up: seat states vs orders, standing counters vs order
 *    lines (the same check as `npm run inventory:check` and the Jest tests)
 *  - Phase 22: for each event with the purchase queue on, never more people
 *    buying at once than its capacity, recounted from the orders (each one
 *    open from its creation until paid / cancelled / expired)
 *  - what the run left behind: orders by status, tickets issued vs paid lines
 * Exit code 1 when something is wrong.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootEnv = parseEnv(readFileSync(path.join(ROOT, '.env'), 'utf8'))
const db = `postgres://${rootEnv.POSTGRES_USER ?? 'etp'}:${encodeURIComponent(rootEnv.POSTGRES_PASSWORD)}@localhost:${rootEnv.POSTGRES_PORT ?? 5432}/etp_load`
Object.assign(process.env, {
  LOG_LEVEL: 'silent',
  DATABASE_URL: db,
  REDIS_URL: 'redis://localhost:6379/2',
  JWT_ACCESS_SECRET: 'load-test-only-access-secret-0123456789abcdef',
  OTP_SECRET: 'load-test-only-otp-secret-0123456789abcdefgh',
  QR_SECRET: 'load-test-only-qr-secret-0123456789abcdefghi',
})
const require = createRequire(path.join(ROOT, 'backend/package.json'))
const { Client } = require('pg')
const { findInventoryMismatches } = require('./src/modules/orders/orders.repository')

const client = new Client({ connectionString: db })
await client.connect()
let failed = false

const doubles = (
  await client.query(
    `SELECT oi.schedule_seat_id, count(*) AS orders
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.schedule_seat_id IS NOT NULL AND o.status IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'COMPLETED')
     GROUP BY oi.schedule_seat_id HAVING count(*) > 1`,
  )
).rows
console.log(doubles.length === 0 ? '✓ no seat belongs to two orders' : `✗ ${doubles.length} seats belong to several orders`, doubles.slice(0, 5))
failed ||= doubles.length > 0

const mismatches = await findInventoryMismatches(client)
console.log(mismatches.length === 0 ? '✓ inventory adds up (seats and standing counters match the orders)' : `✗ ${mismatches.length} inventory mismatches`, mismatches.slice(0, 5))
failed ||= mismatches.length > 0

// Phase 22: the most orders of a queued event open at the same moment (a sweep over start / end
// points; at the same instant an order ending counts before one starting: the turn is given back first).
const queued = (
  await client.query(
    `WITH spans AS (
       SELECT e.id AS event_id, e.title, e.queue_capacity, o.created_at AS starts,
              coalesce(o.paid_at, o.cancelled_at, CASE WHEN o.status IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED') THEN now() ELSE o.expires_at END) AS ends
       FROM orders o
       JOIN event_schedules s ON s.id = o.schedule_id
       JOIN events e ON e.id = s.event_id
       WHERE e.queue_enabled
     ), points AS (
       SELECT event_id, title, queue_capacity, starts AS at, 1 AS change FROM spans
       UNION ALL
       SELECT event_id, title, queue_capacity, ends, -1 FROM spans
     ), running AS (
       SELECT event_id, title, queue_capacity, sum(change) OVER (PARTITION BY event_id ORDER BY at, change) AS open FROM points
     )
     SELECT event_id, title, queue_capacity AS capacity, max(open)::int AS most_open, (SELECT count(*)::int FROM spans x WHERE x.event_id = r.event_id) AS orders
     FROM running r GROUP BY event_id, title, queue_capacity ORDER BY title`,
  )
).rows
for (const row of queued) {
  const ok = row.most_open <= row.capacity
  console.log(`${ok ? '✓' : '✗'} purchase queue "${row.title}": at most ${row.most_open} of ${row.orders} orders open at once (capacity ${row.capacity})`)
  failed ||= !ok
}

const byStatus = (await client.query(`SELECT status, count(*)::int AS n FROM orders GROUP BY status ORDER BY status`)).rows
console.log('orders by status:', Object.fromEntries(byStatus.map((r) => [r.status, r.n])))

const tickets = (
  await client.query(
    `SELECT (SELECT coalesce(sum(oi.quantity), 0)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status IN ('PAID', 'COMPLETED')) AS paid_lines,
            (SELECT count(*)::int FROM tickets WHERE status IN ('VALID', 'USED')) AS issued`,
  )
).rows[0]
console.log(`tickets: ${tickets.issued} issued for ${tickets.paid_lines} paid places${tickets.issued === tickets.paid_lines ? ' ✓' : ' (the worker may still be issuing)'}`)

await client.end()
process.exit(failed ? 1 : 0)

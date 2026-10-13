/**
 * After a k6 run: is the data still right? (TEST-03 correctness part)
 *
 *   node loadtest/verify.mjs
 *
 *  - no seat line of two open / paid orders on the same seat (no double sale)
 *  - the inventory adds up: seat states vs orders, standing counters vs order
 *    lines (the same check as `npm run inventory:check` and the Jest tests)
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

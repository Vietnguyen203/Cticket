import { createRequire } from 'node:module'
import path from 'node:path'
import { BACKEND_DIR, stackUrls } from '../stack.mjs'

/**
 * Direct SQL on the E2E database, only for what a test cannot wait for in
 * real time (a 10-minute hold running out, a show starting in 3 hours).
 */
// pg comes from the backend's node_modules (no second copy, no types needed).
interface PgPool {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}
const require = createRequire(path.join(BACKEND_DIR, 'package.json'))
const { Pool } = require('pg') as { Pool: new (config: { connectionString: string; max: number }) => PgPool }

let pool: PgPool | null = null

export async function sql(text: string, params: unknown[] = []) {
  pool ??= new Pool({ connectionString: stackUrls().database, max: 2 })
  return (await pool.query(text, params)).rows
}

/** The order's hold runs out now (instead of in 10 minutes). */
export async function makeHoldDue(orderId: string) {
  await sql(`UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1`, [orderId])
  await sql(`UPDATE schedule_seats SET hold_expires_at = now() - interval '1 second' WHERE held_by_order_id = $1`, [orderId])
}

/** The show starts in an hour: the gates (open 3 hours before) are open. */
export async function openGates(scheduleId: string) {
  await sql(
    `UPDATE event_schedules
     SET start_at = now() + interval '1 hour', end_at = now() + interval '3 hours',
         sales_end_at = LEAST(sales_end_at, now() + interval '1 hour')
     WHERE id = $1`,
    [scheduleId],
  )
}

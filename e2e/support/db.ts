import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { BACKEND_DIR, E2E_ADMIN, stackUrls } from '../stack.mjs'

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

/**
 * A new admin for one test (Phase 15: admins must use two-factor). A copy of
 * the seeded E2E admin: same password and, with `twoFactor`, the same TOTP
 * secret (E2E_TOTP_SECRET), but its own "last used step". A code works once
 * per account, so tests running at the same moment never use up each other's.
 * Without `twoFactor` it is an admin who must set it up at the first login.
 */
export async function createAdminAccount({ twoFactor = true, firstName = 'Quản trị' } = {}) {
  const email = `admin-${randomUUID().slice(0, 8)}@e2e.test`
  const [created] = await sql(
    `WITH source AS (
       SELECT u.password_hash, t.secret_encrypted FROM users u JOIN user_totp t ON t.user_id = u.id WHERE u.email = $1
     ), new_user AS (
       INSERT INTO users (email, password_hash, first_name, last_name, status, email_verified_at)
       SELECT $2, password_hash, $4, 'E2E', 'ACTIVE', now() FROM source
       RETURNING id
     ), with_role AS (
       INSERT INTO user_roles (user_id, role_id) SELECT nu.id, r.id FROM new_user nu CROSS JOIN roles r WHERE r.code = 'ADMIN'
     ), with_totp AS (
       INSERT INTO user_totp (user_id, secret_encrypted, enabled_at)
       SELECT nu.id, source.secret_encrypted, now() FROM new_user nu CROSS JOIN source WHERE $3
     )
     SELECT id FROM new_user`,
    [E2E_ADMIN.email, email, twoFactor, firstName],
  )
  if (!created) throw new Error(`The seeded E2E admin ${E2E_ADMIN.email} has no two-factor secret`)
  return { email, password: E2E_ADMIN.password, id: created.id as string }
}

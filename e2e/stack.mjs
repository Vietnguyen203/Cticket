/**
 * Where the E2E stack runs (shared by playwright.config.ts, the API starter
 * and the tests). Nothing here touches the dev database or sends real email:
 *
 *   Playwright ─► Vite :5180 ─/api,/ws─► API :3100 ─► PostgreSQL "etp_e2e", Redis db 14, Mailpit
 *
 * Locally the database / Redis addresses come from backend/.env (the ones the
 * Jest tests use, with another database name and Redis db). CI sets
 * E2E_DATABASE_URL and E2E_REDIS_URL instead.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url))
export const ROOT_DIR = path.resolve(E2E_DIR, '..')
export const BACKEND_DIR = path.join(ROOT_DIR, 'backend')
export const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend')

export const API_PORT = 3100
export const WEB_PORT = 5180
export const API_URL = `http://localhost:${API_PORT}`
export const WEB_URL = `http://localhost:${WEB_PORT}`
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025'
export const MAILPIT_SMTP_PORT = process.env.MAILPIT_SMTP_PORT ?? '1025'

/** The admin seeded into the E2E database at every run (test-only account). */
export const E2E_ADMIN = { email: 'admin@e2e.test', password: 'E2e-Admin-Pass-2026' }

/** Read only the two TEST_* addresses from backend/.env, never the rest (it may hold real SMTP credentials). */
function testAddresses() {
  const file = path.join(BACKEND_DIR, '.env')
  const parsed = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
  return { database: parsed.TEST_DATABASE_URL, redis: parsed.TEST_REDIS_URL }
}

function withDatabase(url, name) {
  const u = new URL(url)
  u.pathname = `/${name}`
  return u.toString()
}

export function stackUrls() {
  const fromFile = testAddresses()
  const database = process.env.E2E_DATABASE_URL ?? (fromFile.database && withDatabase(fromFile.database, 'etp_e2e'))
  const redis = process.env.E2E_REDIS_URL ?? (fromFile.redis && withDatabase(fromFile.redis, '14'))
  if (!database || !redis) {
    throw new Error('Set E2E_DATABASE_URL and E2E_REDIS_URL, or TEST_DATABASE_URL / TEST_REDIS_URL in backend/.env')
  }
  return { database, redis }
}

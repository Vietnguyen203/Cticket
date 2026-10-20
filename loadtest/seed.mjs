/**
 * Data for the k6 scenarios, in the load test database (etp_load) through the
 * load test API (http://localhost:3200). Run from the project root, the load
 * stack running:
 *
 *   node loadtest/seed.mjs
 *
 * Creates (each run adds a new set; the k6 scripts use the latest one):
 *  - 1 big event: 2.000 seats (VIP rows A–J, STD rows K–AN, 50 per row) + 5.000 standing
 *  - 50 smaller events (standing only) so lists and search have something to page through
 *  - 2.000 customers with access tokens (2 hours, signed with the load stack's test-only secret)
 *    (LOAD_CUSTOMERS=N for more: at least the VUS of the scenarios that need one account per user)
 *  - Phase 22: 1 event with the purchase queue on (LOAD_QUEUE_CAPACITY people buy at once,
 *    default 50; 5-minute turns) and 20.000 standing tickets, for k6/queue.js
 * and writes loadtest/.data/data.json for k6 (git-ignored).
 *
 * Accounts are made straight in the database (registration and its emails are
 * not what is measured); everything else goes through the API, so the data
 * obeys the same rules as real data.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const API = process.env.LOAD_API_URL ?? 'http://localhost:3200/api/v1'
const CUSTOMERS = Number(process.env.LOAD_CUSTOMERS ?? 2000)
const SMALL_EVENTS = 50
const QUEUE_CAPACITY = Number(process.env.LOAD_QUEUE_CAPACITY ?? 50)
const QUEUE_TICKETS = 20_000

// Database address from the root .env (the same PostgreSQL the dev stack uses).
const rootEnv = parseEnv(readFileSync(path.join(ROOT, '.env'), 'utf8'))
const db = `postgres://${rootEnv.POSTGRES_USER ?? 'etp'}:${encodeURIComponent(rootEnv.POSTGRES_PASSWORD)}@localhost:${rootEnv.POSTGRES_PORT ?? 5432}/etp_load`

// The backend's own token code, with the load stack's test-only settings (loadtest/docker-compose.yml).
Object.assign(process.env, {
  NODE_ENV: 'development',
  LOG_LEVEL: 'silent',
  DATABASE_URL: db,
  REDIS_URL: 'redis://localhost:6379/2',
  JWT_ACCESS_SECRET: 'load-test-only-access-secret-0123456789abcdef',
  JWT_ACCESS_TTL_SECONDS: '7200',
  OTP_SECRET: 'load-test-only-otp-secret-0123456789abcdefgh',
  QR_SECRET: 'load-test-only-qr-secret-0123456789abcdefghi',
})
const require = createRequire(path.join(ROOT, 'backend/package.json'))
const { Client } = require('pg')
const { signAccessToken } = require('./src/modules/auth/auth.tokens')

const sql = new Client({ connectionString: db })
await sql.connect()
const run = Date.now().toString(36)

// --- accounts (SQL) ------------------------------------------------------------

async function createUsers(count, roles, prefix) {
  const { rows } = await sql.query(
    `WITH new_users AS (
       INSERT INTO users (email, password_hash, first_name, last_name, status, email_verified_at)
       SELECT $2 || '-' || $3 || '-' || g || '@load.test', 'not-a-real-hash', 'Load', 'User ' || g, 'ACTIVE', now()
       FROM generate_series(1, $1) g
       RETURNING id
     ), with_roles AS (
       INSERT INTO user_roles (user_id, role_id)
       SELECT nu.id, r.id FROM new_users nu CROSS JOIN roles r WHERE r.code = ANY($4)
       RETURNING user_id
     )
     SELECT DISTINCT user_id AS id FROM with_roles`,
    [count, prefix, run, roles],
  )
  return rows.map(({ id }) => ({ id, token: signAccessToken({ id, roles }).accessToken }))
}

const [admin] = await createUsers(1, ['ADMIN', 'CUSTOMER'], 'admin')
const [organizerUser] = await createUsers(1, ['CUSTOMER', 'ORGANIZER'], 'organizer')
await sql.query(`INSERT INTO organizers (user_id, organization_name, status) VALUES ($1, $2, 'ACTIVE')`, [
  organizerUser.id,
  `Load Test Organizer ${run}`,
])

// --- API helpers ---------------------------------------------------------------

async function call(token, method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json.error ?? json)}`)
  return json.data
}
const asAdmin = (method, url, body) => call(admin.token, method, url, body)
const asOrganizer = (method, url, body) => call(organizerUser.token, method, url, body)

const DAY_MS = 86_400_000
function at(daysFromNow, hour) {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return new Date(d.getTime() + daysFromNow * DAY_MS + hour * 3_600_000).toISOString()
}

/** Row labels A..Z, AA..AN */
const rowLabel = (i) => (i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + i - 26)}`)

async function publish(eventId) {
  await asOrganizer('PATCH', `/events/${eventId}/status`, { status: 'PENDING_APPROVAL' })
  return (await asAdmin('PATCH', `/events/${eventId}/status`, { status: 'PUBLISHED' })).event
}

// --- the big event -------------------------------------------------------------

const { category } = await asAdmin('POST', '/categories', { name: `Hòa nhạc tải ${run}` })
const { venue } = await asAdmin('POST', '/venues', {
  name: `Sân vận động tải ${run}`,
  addressLine: '1 Lê Duẩn',
  city: 'Hà Nội',
  capacity: 7000,
})
const { zone: seated } = await asAdmin('POST', `/venues/${venue.id}/zones`, { code: 'S', name: 'Khán đài', kind: 'SEATED' })
const { zone: pit } = await asAdmin('POST', `/venues/${venue.id}/zones`, { code: 'PIT', name: 'Sàn đứng', kind: 'STANDING', capacity: 5000 })
const ROWS = 40
await asAdmin('POST', `/zones/${seated.id}/seats/bulk`, {
  rows: Array.from({ length: ROWS }, (_, i) => ({ rowLabel: rowLabel(i), from: 1, to: 50 })),
})
const layout = await call(admin.token, 'GET', `/venues/${venue.id}/layout`)
const seats = layout.zones.find((z) => z.code === 'S').seats

const { event: big } = await asOrganizer('POST', '/events', { title: `Đại nhạc hội tải ${run}`, categoryIds: [category.id] })
const { schedule } = await asOrganizer('POST', `/events/${big.id}/schedules`, { venueId: venue.id, startAt: at(30, 12), endAt: at(30, 16) })
const tt = async (body) => (await asOrganizer('POST', `/schedules/${schedule.id}/ticket-types`, body)).ticketType
const vip = await tt({ code: 'VIP', name: 'VIP', price: 3_000_000, inventoryMode: 'RESERVED' })
const std = await tt({ code: 'STD', name: 'Khán đài', price: 1_500_000, inventoryMode: 'RESERVED' })
const ga = await tt({ code: 'GA', name: 'Sàn đứng', price: 500_000, inventoryMode: 'GENERAL_ADMISSION', capacity: 5000, venueZoneId: pit.id })
const labels = Array.from({ length: ROWS }, (_, i) => rowLabel(i))
await asOrganizer('PUT', `/schedules/${schedule.id}/seat-plan`, {
  assignments: [
    { ticketTypeId: vip.id, zoneId: seated.id, rows: labels.slice(0, 10) },
    { ticketTypeId: std.id, zoneId: seated.id, rows: labels.slice(10) },
  ],
})
const bigPublished = await publish(big.id)
console.log(`big event: ${bigPublished.slug} (${seats.length} seats + 5000 standing)`)

// --- smaller events (lists, search) ---------------------------------------------

const WORDS = ['Mùa thu', 'Hà Nội', 'Sài Gòn', 'Jazz', 'Acoustic', 'Bolero', 'Rock', 'Giao hưởng', 'Hài kịch', 'Ballet']
const events = [{ id: bigPublished.id, slug: bigPublished.slug, title: bigPublished.title }]
let smallVenue = null
for (let i = 0; i < SMALL_EVENTS; i++) {
  if (i % 10 === 0) {
    smallVenue = (await asAdmin('POST', '/venues', { name: `Nhà hát tải ${run}-${i / 10}`, addressLine: '2 Tràng Tiền', city: 'Hồ Chí Minh', capacity: 300 })).venue
  }
  const title = `${WORDS[i % WORDS.length]} đêm ${i + 1} (${run})`
  const { event } = await asOrganizer('POST', '/events', { title, categoryIds: [category.id] })
  const day = 5 + (i % 10) * 7 + Math.floor(i / 10) // distinct days per venue
  const { schedule: s } = await asOrganizer('POST', `/events/${event.id}/schedules`, { venueId: smallVenue.id, startAt: at(day, 12), endAt: at(day, 14) })
  await asOrganizer('POST', `/schedules/${s.id}/ticket-types`, { code: 'GA', name: 'Vé thường', price: 300_000, inventoryMode: 'GENERAL_ADMISSION', capacity: 200 })
  const published = await publish(event.id)
  events.push({ id: published.id, slug: published.slug, title })
}
console.log(`${events.length} published events`)

// --- Phase 22: the event with the purchase queue on -------------------------------

const { venue: arena } = await asAdmin('POST', '/venues', { name: `Sân khấu hàng chờ ${run}`, addressLine: '3 Hai Bà Trưng', city: 'Hà Nội', capacity: QUEUE_TICKETS })
const { zone: floor } = await asAdmin('POST', `/venues/${arena.id}/zones`, { code: 'FLOOR', name: 'Sàn', kind: 'STANDING', capacity: QUEUE_TICKETS })
const { event: rush } = await asOrganizer('POST', '/events', { title: `Mở bán hàng chờ ${run}`, categoryIds: [category.id] })
const { schedule: rushSchedule } = await asOrganizer('POST', `/events/${rush.id}/schedules`, { venueId: arena.id, startAt: at(40, 12), endAt: at(40, 15) })
const rushGa = (
  await asOrganizer('POST', `/schedules/${rushSchedule.id}/ticket-types`, {
    code: 'GA', name: 'Vé sàn', price: 400_000, inventoryMode: 'GENERAL_ADMISSION', capacity: QUEUE_TICKETS, venueZoneId: floor.id,
  })
).ticketType
await publish(rush.id)
await asOrganizer('PATCH', `/events/${rush.id}`, { queueEnabled: true, queueCapacity: QUEUE_CAPACITY, queueSessionMinutes: 5 })
console.log(`queue event: ${QUEUE_TICKETS} standing tickets, ${QUEUE_CAPACITY} people buy at once`)

// --- customers -----------------------------------------------------------------

const customers = await createUsers(CUSTOMERS, ['CUSTOMER'], 'buyer')
console.log(`${customers.length} customers`)
await sql.end()

const seatId = (row, n) => seats.find((s) => s.rowLabel === row && s.seatNumber === n).id
const data = {
  createdAt: new Date().toISOString(),
  run,
  big: {
    eventId: bigPublished.id,
    slug: bigPublished.slug,
    scheduleId: schedule.id,
    gaTicketTypeId: ga.id,
    // contention: the 50 seats of the front row
    hotSeatIds: Array.from({ length: 50 }, (_, i) => seatId('A', i + 1)),
    // purchases in the mixed scenario: every other seat
    seatIds: seats.filter((s) => s.rowLabel !== 'A').map((s) => s.id),
  },
  queue: {
    eventId: rush.id,
    scheduleId: rushSchedule.id,
    gaTicketTypeId: rushGa.id,
    capacity: QUEUE_CAPACITY,
    organizerToken: organizerUser.token, // the queue numbers (GET /events/:id/queue/stats)
  },
  events,
  searchTerms: WORDS,
  tokens: customers.map((c) => c.token),
}
mkdirSync(path.join(HERE, '.data'), { recursive: true })
writeFileSync(path.join(HERE, '.data', 'data.json'), JSON.stringify(data))
console.log('wrote loadtest/.data/data.json')

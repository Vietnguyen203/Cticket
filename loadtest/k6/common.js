import http from 'k6/http'
import { check, sleep } from 'k6'
import { SharedArray } from 'k6/data'
import { Counter } from 'k6/metrics'

/**
 * Shared by the 4 scenarios. Data comes from loadtest/.data/data.json (node
 * loadtest/seed.mjs). SharedArray: one copy in memory for all VUs, not one
 * per VU (2.000 tokens × 500 VUs would not fit).
 */
export const API = __ENV.API_URL || 'http://localhost:3200/api/v1'
// The terms of sale a buyer accepts at checkout (backend/src/config/constants.js TERMS_VERSION).
export const TERMS_VERSION = '2026-10-27'

const load = (name, pick) => new SharedArray(name, () => pick(JSON.parse(open('../.data/data.json'))))
export const tokens = load('tokens', (d) => d.tokens)
export const events = load('events', (d) => d.events)
export const searchTerms = load('terms', (d) => d.searchTerms)
export const hotSeatIds = load('hot seats', (d) => d.big.hotSeatIds)
export const seatIds = load('seats', (d) => d.big.seatIds)
export const big = load('big', (d) => [{ eventId: d.big.eventId, slug: d.big.slug, scheduleId: d.big.scheduleId, gaTicketTypeId: d.big.gaTicketTypeId }])[0]
// Phase 22: the event with the purchase queue on (undefined with data seeded before Phase 22)
export const queueEvent = load('queue', (d) => (d.queue ? [d.queue] : []))[0]

/** 409 (seat taken, cart exists) and 422 are answers, not failures: they do not count in http_req_failed. */
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409, 422))

export const refusals = new Counter('refusals') // 409 / 422 by error code (tag "code")

export const pick = (list) => list[Math.floor(Math.random() * list.length)]
export const think = (min = 1, max = 3) => sleep(min + Math.random() * (max - min))

export const authHeaders = (token, extra = {}) => ({ headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra } })

// What a browser sends: the server may compress.
const BROWSER_HEADERS = { 'Accept-Encoding': 'gzip, deflate, br' }

export function get(url, name, params = {}) {
  return http.get(`${API}${url}`, { ...params, headers: { ...BROWSER_HEADERS, ...(params.headers || {}) }, tags: { name, ...(params.tags || {}) } })
}

export function post(url, name, token, body, extraHeaders) {
  return http.post(`${API}${url}`, JSON.stringify(body ?? {}), { ...authHeaders(token, extraHeaders), tags: { name } })
}

export function errorCode(res) {
  try {
    return res.json('error.code') || 'none'
  } catch {
    return 'not-json'
  }
}

// --- the user journeys, reused by the mixed scenario ------------------------------

/** An anonymous visitor: home list, maybe a search, an event page. */
export function browse() {
  const list = get('/events?pageSize=12', 'GET /events')
  check(list, { 'list 200': (r) => r.status === 200 })
  get('/categories', 'GET /categories')
  if (Math.random() < 0.4) {
    check(get(`/events?q=${encodeURIComponent(pick(searchTerms))}&pageSize=12`, 'GET /events?q'), { 'search 200': (r) => r.status === 200 })
  }
  const detail = get(`/events/${pick(events).slug}`, 'GET /events/:slug')
  check(detail, { 'detail 200': (r) => r.status === 200 })
  think()
}

/** Someone on the seat page of the big event: layout + live availability. */
export function seatMap() {
  const map = get(`/schedules/${big.scheduleId}/seat-map`, 'GET /seat-map')
  check(map, { 'seat map 200': (r) => r.status === 200 })
  check(get(`/schedules/${big.scheduleId}/availability`, 'GET /availability'), { 'availability 200': (r) => r.status === 200 })
  think(2, 5)
}

/**
 * A full purchase on the big event: mostly standing tickets (5.000), some
 * seats (taken seats answer 409, as in real life). Hold → checkout → pay.
 */
export function purchase(token) {
  const body = Math.random() < 0.8 ? { items: [{ ticketTypeId: big.gaTicketTypeId, quantity: 1 + Math.floor(Math.random() * 2) }] } : { seatIds: [pick(seatIds)] }
  const hold = post(`/schedules/${big.scheduleId}/orders`, 'POST hold', token, body)
  if (hold.status !== 201) {
    refusals.add(1, { code: errorCode(hold) })
    think(1, 2)
    return false
  }
  const orderId = hold.json('data.order.id')
  const checkout = post(`/orders/${orderId}/checkout`, 'POST checkout', token, { termsVersion: TERMS_VERSION })
  const paid = checkout.status === 200 && post('/payments', 'POST pay', token, { orderId }, { 'Idempotency-Key': crypto.randomUUID() })
  const ok = check(paid, { 'paid 201': (r) => r && r.status === 201 })
  if (!ok) post(`/orders/${orderId}/cancel`, 'POST cancel', token, {}) // never leave a cart behind
  think(1, 3)
  return ok
}

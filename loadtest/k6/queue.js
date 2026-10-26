// Scenario 5 (Phase 22) — the opening of sales of a crowded event with the
// purchase queue on (Phase 21): VUS buyers arrive at once (or over SPREAD),
// wait their turn, then buy 1 standing ticket each. A sixth "organizer" user
// reads the queue numbers every second: never more than N people buying.
//   LOAD_CUSTOMERS=1000 node loadtest/seed.mjs        (LOAD_QUEUE_CAPACITY=N, default 50)
//   k6 run -e VUS=1000 loadtest/k6/queue.js
//   k6 run -e VUS=500 -e SPREAD=30s -e THINK=5-15 loadtest/k6/queue.js
//   node loadtest/verify.mjs
//
//   VUS       buyers (default 500), one account each
//   SPREAD    buyers arrive over this long (default 0s: everyone at once)
//   THINK     seconds a buyer spends choosing once in, "min-max" (default 5-15)
//   MAX_WAIT  a buyer still waiting after this long gives up (default 15m): counted, fails the run
import http from 'k6/http'
import { check, sleep } from 'k6'
import exec from 'k6/execution'
import { Counter, Trend } from 'k6/metrics'
import { API, authHeaders, errorCode, get, post, queueEvent, refusals, TERMS_VERSION, tokens } from './common.js'
import { assertAccounts, seconds } from './profile.js'

if (!queueEvent) throw new Error('No event with a purchase queue in loadtest/.data/data.json: run node loadtest/seed.mjs again')

const VUS = Number(__ENV.VUS ?? 500)
const SPREAD = seconds(__ENV.SPREAD ?? '0s')
const [THINK_MIN, THINK_MAX] = (__ENV.THINK ?? '5-15').split('-').map(Number)
const MAX_WAIT_MS = seconds(__ENV.MAX_WAIT ?? '15m') * 1000
const POLL_SECONDS = 3 // as the waiting page of the web app (5 s there; a bit faster here, more load)
const N = queueEvent.capacity
assertAccounts(VUS, tokens.length)

const queueWait = new Trend('queue_wait', true)
const activeSeen = new Trend('queue_active_seen')
const waitingSeen = new Trend('queue_waiting_seen')
const admitted = new Counter('queue_admitted')
const gaveUp = new Counter('queue_gave_up')
const purchases = new Counter('purchases_completed')

export const options = {
  scenarios: {
    rush: { executor: 'per-vu-iterations', vus: VUS, iterations: 1, maxDuration: '30m', exec: 'buyer' },
    organizer: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m', exec: 'watch' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:POST queue}': ['p(95)<300'],
    'http_req_duration{name:GET queue}': ['p(95)<300'],
    'http_req_duration{name:POST hold}': ['p(95)<800'],
    'http_req_duration{name:POST pay}': ['p(95)<800'],
    queue_active_seen: [`max<=${N}`], // the point of the queue
    queue_admitted: [`count==${VUS}`], // everyone got in
    queue_gave_up: ['count==0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const queueUrl = `/events/${queueEvent.eventId}/queue`
const viewOf = (res) => (res.status === 200 ? res.json('data.queue') : null)
const leave = (token) => http.del(`${API}${queueUrl}`, null, { ...authHeaders(token), tags: { name: 'DELETE queue' } })

export function buyer() {
  // One customer per buyer. Not exec.vu.idInTest: the organizer's VU is numbered among them.
  const token = tokens[exec.scenario.iterationInTest]
  if (SPREAD > 0) sleep(Math.random() * SPREAD)

  const joinedAt = Date.now()
  let view = viewOf(post(queueUrl, 'POST queue', token, {}))
  while (!view || view.state !== 'ACTIVE') {
    if (Date.now() - joinedAt > MAX_WAIT_MS) {
      gaveUp.add(1)
      leave(token)
      return
    }
    sleep(POLL_SECONDS)
    // Not in line yet (the join failed, e.g. no connection): join again. In line: ask where.
    const next = view ? viewOf(get(queueUrl, 'GET queue', authHeaders(token))) : viewOf(post(queueUrl, 'POST queue', token, {}))
    // NONE: the place was lost (it never should be): join again, as the web page does.
    view = next && next.state === 'NONE' ? viewOf(post(queueUrl, 'POST queue', token, {})) : next ?? view
  }
  queueWait.add(Date.now() - joinedAt)
  admitted.add(1)

  sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN)) // choosing
  const hold = post(`/schedules/${queueEvent.scheduleId}/orders`, 'POST hold', token, {
    items: [{ ticketTypeId: queueEvent.gaTicketTypeId, quantity: 1 }],
  })
  if (hold.status !== 201) {
    refusals.add(1, { code: errorCode(hold) })
    leave(token) // give the turn to the next one
    return
  }
  const orderId = hold.json('data.order.id')
  const checkout = post(`/orders/${orderId}/checkout`, 'POST checkout', token, { termsVersion: TERMS_VERSION })
  const paid = checkout.status === 200 && post('/payments', 'POST pay', token, { orderId }, { 'Idempotency-Key': crypto.randomUUID() })
  if (check(paid, { 'paid 201': (r) => r && r.status === 201 })) purchases.add(1)
  else post(`/orders/${orderId}/cancel`, 'POST cancel', token, {}) // ends the turn too
}

/** The organizer's view, every second, until the queue is empty again. */
export function watch() {
  const startedAt = Date.now()
  let seenSomeone = false
  for (;;) {
    if (!seenSomeone && Date.now() - startedAt > SPREAD * 1000 + 120_000) return // nobody came: nothing to watch
    const res = get(`${queueUrl}/stats`, 'GET queue stats', authHeaders(queueEvent.organizerToken))
    if (res.status === 200) {
      const { active, waiting } = res.json('data.queue')
      activeSeen.add(active)
      waitingSeen.add(waiting)
      if (active + waiting > 0) seenSomeone = true
      else if (seenSomeone) return
    }
    sleep(1)
  }
}

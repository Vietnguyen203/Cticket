// Scenario 3 — contention: 500 buyers fight over the 50 seats of the front row
// for 1 minute. A winner keeps the seat half a second, then cancels, so the
// fight goes on. Afterwards `node loadtest/verify.mjs` checks that no seat was
// ever held or sold twice and that the inventory adds up.
//   k6 run loadtest/k6/contention.js
//   k6 run -e VUS=1000 -e SHAPE=spike -e DURATION=1m loadtest/k6/contention.js   (Phase 22: see profile.js)
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'
import { big, errorCode, hotSeatIds, pick, post, refusals, tokens } from './common.js'
import { assertAccounts, loadProfile } from './profile.js'

const profile = loadProfile(__ENV, {
  vus: 500,
  ramp: '5s',
  duration: '1m',
  stages: [
    { duration: '5s', target: 500 },
    { duration: '1m', target: 500 },
  ],
})
assertAccounts(profile.vus, tokens.length) // one customer (one cart) per VU

const won = new Counter('holds_won')

export const options = {
  scenarios: {
    // 500 buyers arrive within 5 s (all at the same instant, Docker Desktop's port
    // forwarding on Windows refuses part of the burst before it reaches the API).
    contention: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: profile.stages,
      exec: 'run',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:POST hold}': ['p(95)<800'],
    'http_req_duration{name:POST cancel}': ['p(95)<800'],
    holds_won: ['count>0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

export function run() {
  const token = tokens[(__VU - 1) % tokens.length] // one customer per VU (one cart per customer)
  const res = post(`/schedules/${big.scheduleId}/orders`, 'POST hold', token, { seatIds: [pick(hotSeatIds)] })
  check(res, { 'held or refused (409)': (r) => r.status === 201 || r.status === 409 })
  if (res.status === 201) {
    won.add(1)
    sleep(0.5)
    post(`/orders/${res.json('data.order.id')}/cancel`, 'POST cancel', token, {})
  } else {
    refusals.add(1, { code: errorCode(res) })
  }
  sleep(0.1 + Math.random() * 0.2)
}

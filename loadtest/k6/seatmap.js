// Scenario 2 — the seat map of a 2.000-seat event: up to 200 virtual users.
//   k6 run loadtest/k6/seatmap.js
//   k6 run -e VUS=500 -e SHAPE=spike loadtest/k6/seatmap.js   (Phase 22: see profile.js)
import { seatMap } from './common.js'
import { loadProfile } from './profile.js'

const profile = loadProfile(__ENV, { vus: 200, ramp: '30s', duration: '2m' })

export const options = {
  scenarios: {
    seatmap: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: profile.stages,
      exec: 'run',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:GET /seat-map}': ['p(95)<300'],
    'http_req_duration{name:GET /availability}': ['p(95)<300'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

export function run() {
  seatMap()
}

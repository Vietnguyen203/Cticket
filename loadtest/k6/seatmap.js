// Scenario 2 — the seat map of a 2.000-seat event: up to 200 virtual users.
//   k6 run loadtest/k6/seatmap.js
import { seatMap } from './common.js'

export const options = {
  scenarios: {
    seatmap: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '2m', target: 200 },
        { duration: '20s', target: 0 },
      ],
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

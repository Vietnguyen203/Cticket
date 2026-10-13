// Scenario 1 — browsing (anonymous, cached catalog): ramp up to 300 virtual users.
//   k6 run loadtest/k6/browse.js
import { browse } from './common.js'

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '30s', target: 300 },
        { duration: '2m', target: 300 },
        { duration: '20s', target: 0 },
      ],
      exec: 'run',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300'],
    'http_req_duration{name:GET /events/:slug}': ['p(95)<300'],
    'http_req_duration{name:GET /events?q}': ['p(95)<300'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

export function run() {
  browse()
}

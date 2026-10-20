// Scenario 1 — browsing (anonymous, cached catalog): ramp up to 300 virtual users.
//   k6 run loadtest/k6/browse.js
//   k6 run -e VUS=1000 -e RAMP=1m -e DURATION=2m loadtest/k6/browse.js   (Phase 22: see profile.js)
import { browse } from './common.js'
import { loadProfile } from './profile.js'

const profile = loadProfile(__ENV, {
  vus: 300,
  ramp: '1m',
  duration: '2m',
  stages: [
    { duration: '30s', target: 100 },
    { duration: '30s', target: 300 },
    { duration: '2m', target: 300 },
    { duration: '20s', target: 0 },
  ],
})

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: profile.stages,
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

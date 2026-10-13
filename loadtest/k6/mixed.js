// Scenario 4 — a mixed day: 70 % browsing, 20 % seat page, 10 % buying, 200
// virtual users for 5 minutes.
//   k6 run loadtest/k6/mixed.js
import { Counter } from 'k6/metrics'
import { browse, purchase, seatMap, tokens } from './common.js'

const purchases = new Counter('purchases_completed')

export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 140, duration: '5m', exec: 'browsing' },
    seatmap: { executor: 'constant-vus', vus: 40, duration: '5m', exec: 'seatPage' },
    buy: { executor: 'constant-vus', vus: 20, duration: '5m', exec: 'buying' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:browse}': ['p(95)<300'],
    'http_req_duration{scenario:seatmap}': ['p(95)<300'],
    'http_req_duration{name:POST hold}': ['p(95)<800'],
    'http_req_duration{name:POST pay}': ['p(95)<800'],
    purchases_completed: ['count>0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

export const browsing = browse
export const seatPage = seatMap

export function buying() {
  // Each VU has its own 5 customers (one cart per customer at a time) and uses them in turn.
  if (purchase(tokens[(__VU * 5 + (__ITER % 5)) % tokens.length])) purchases.add(1)
}

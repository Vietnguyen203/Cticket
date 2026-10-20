// Scenario 4 — a mixed day: 70 % browsing, 20 % seat page, 10 % buying, 200
// virtual users for 5 minutes.
//   k6 run loadtest/k6/mixed.js
//   k6 run -e VUS=1000 -e RAMP=1m -e DURATION=3m loadtest/k6/mixed.js   (Phase 22: VUS split 70 / 20 / 10)
import { Counter } from 'k6/metrics'
import { browse, purchase, seatMap, tokens } from './common.js'
import { assertAccounts, loadProfile, profileGiven, split } from './profile.js'

const purchases = new Counter('purchases_completed')
const ACCOUNTS_PER_BUYER = 5

/** Each part of the mix: the Phase 13 constant users, or the -e profile scaled to its share. */
function part(exec, vus) {
  if (!profileGiven(__ENV)) return { executor: 'constant-vus', vus, duration: '5m', exec }
  const { stages } = loadProfile({ ...__ENV, VUS: String(vus) }, { vus, ramp: '30s', duration: '5m' })
  return { executor: 'ramping-vus', startVUs: 0, stages, exec }
}
const [browsers, seatViewers, buyers] = profileGiven(__ENV) ? split(Number(__ENV.VUS ?? 200), [70, 20, 10]) : [140, 40, 20]
assertAccounts(buyers * ACCOUNTS_PER_BUYER, tokens.length)

export const options = {
  scenarios: {
    browse: part('browsing', browsers),
    seatmap: part('seatPage', seatViewers),
    buy: part('buying', buyers),
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
  if (purchase(tokens[(__VU * ACCOUNTS_PER_BUYER + (__ITER % ACCOUNTS_PER_BUYER)) % tokens.length])) purchases.add(1)
}

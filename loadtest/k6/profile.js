/**
 * Phase 22: how many virtual users, and how they arrive, chosen when running:
 *
 *   k6 run -e VUS=1000 -e RAMP=30s -e DURATION=2m -e SHAPE=spike loadtest/k6/contention.js
 *
 *   VUS       users at the peak
 *   RAMP      time from 0 to VUS (ramp, steps)
 *   DURATION  time at the peak
 *   SHAPE     ramp (default): up in RAMP, hold, down in 20 s
 *             spike: everyone at once (up in 1 s), hold, down
 *             steps: 25 / 50 / 75 / 100 % of VUS, RAMP / 4 each, then hold
 *
 * Without them, each scenario keeps the numbers it was measured with in
 * Phase 13 (`defaults.stages`), so old and new results can be compared. Pure
 * (no k6 import): tested with `node --test loadtest/k6/profile.test.js`.
 */

const SHAPES = ['ramp', 'spike', 'steps']
const RAMP_DOWN = '20s'

/** "30s", "2m", "1m30s" → seconds. */
export function seconds(text) {
  const match = /^(?:(\d+)m)?(?:(\d+)s)?$/.exec(String(text).trim())
  if (!match || (!match[1] && !match[2])) throw new Error(`Not a duration: "${text}" (use e.g. 30s, 2m, 1m30s)`)
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

const asDuration = (s) => `${Math.max(1, Math.round(s))}s`
const PROFILE_VARIABLES = ['VUS', 'RAMP', 'DURATION', 'SHAPE']

/** Was any of VUS / RAMP / DURATION / SHAPE given? */
export const profileGiven = (env) => PROFILE_VARIABLES.some((name) => env[name] !== undefined)

/**
 * @param {Record<string, string|undefined>} env  k6's __ENV
 * @param {{ vus: number, ramp: string, duration: string, shape?: string, stages?: Array }} defaults  the
 *   scenario's own numbers; `stages`: its exact Phase 13 stages, used when no variable is given
 * @returns {{ vus: number, shape: string, stages: Array<{ duration: string, target: number }> }}
 */
export function loadProfile(env, defaults) {
  if (defaults.stages && !profileGiven(env)) return { vus: defaults.vus, shape: 'default', stages: defaults.stages }
  const vus = Number(env.VUS ?? defaults.vus)
  if (!Number.isInteger(vus) || vus < 1) throw new Error(`VUS must be a whole number ≥ 1 (got "${env.VUS}")`)
  const shape = env.SHAPE ?? defaults.shape ?? 'ramp'
  if (!SHAPES.includes(shape)) throw new Error(`SHAPE must be one of ${SHAPES.join(', ')} (got "${shape}")`)
  const ramp = seconds(env.RAMP ?? defaults.ramp)
  const hold = env.DURATION ?? defaults.duration
  seconds(hold) // checked

  let up
  if (shape === 'spike') up = [{ duration: '1s', target: vus }]
  else if (shape === 'steps') up = [1, 2, 3, 4].map((i) => ({ duration: asDuration(ramp / 4), target: Math.max(1, Math.round((vus * i) / 4)) }))
  else up = [{ duration: asDuration(ramp), target: vus }]
  return { vus, shape, stages: [...up, { duration: hold, target: vus }, { duration: RAMP_DOWN, target: 0 }] }
}

/** Split `vus` by weights (the mixed scenario: 70 / 20 / 10), each part at least 1, the total kept. */
export function split(vus, weights) {
  const total = weights.reduce((a, b) => a + b, 0)
  const parts = weights.map((w) => Math.max(1, Math.floor((vus * w) / total)))
  parts[0] += Math.max(0, vus - parts.reduce((a, b) => a + b, 0))
  return parts
}

/** Scenarios where every user needs their own account: refuse to start with too few. */
export function assertAccounts(vus, accounts) {
  if (vus > accounts) {
    throw new Error(`VUS=${vus} but only ${accounts} customers were seeded: run LOAD_CUSTOMERS=${vus} node loadtest/seed.mjs first`)
  }
}

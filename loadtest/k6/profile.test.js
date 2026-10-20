// node --test loadtest/k6  (Phase 22: the stages built from -e VUS / RAMP / DURATION / SHAPE)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertAccounts, loadProfile, profileGiven, seconds, split } from './profile.js'

const DEFAULTS = { vus: 500, ramp: '5s', duration: '1m' }

test('durations', () => {
  assert.equal(seconds('30s'), 30)
  assert.equal(seconds('2m'), 120)
  assert.equal(seconds('1m30s'), 90)
  assert.throws(() => seconds('soon'), /Not a duration/)
})

test('no variables: the scenario keeps its own numbers', () => {
  assert.deepEqual(loadProfile({}, DEFAULTS), {
    vus: 500,
    shape: 'ramp',
    stages: [{ duration: '5s', target: 500 }, { duration: '1m', target: 500 }, { duration: '20s', target: 0 }],
  })
})

test('VUS / RAMP / DURATION / SHAPE', () => {
  assert.deepEqual(loadProfile({ VUS: '1000', RAMP: '30s', DURATION: '2m' }, DEFAULTS).stages, [
    { duration: '30s', target: 1000 },
    { duration: '2m', target: 1000 },
    { duration: '20s', target: 0 },
  ])
  assert.deepEqual(loadProfile({ VUS: '1000', SHAPE: 'spike' }, DEFAULTS).stages[0], { duration: '1s', target: 1000 })
  assert.deepEqual(
    loadProfile({ VUS: '200', RAMP: '40s', SHAPE: 'steps' }, DEFAULTS).stages.slice(0, 4),
    [50, 100, 150, 200].map((target) => ({ duration: '10s', target })),
  )
})

test('wrong values stop the run', () => {
  assert.throws(() => loadProfile({ VUS: '0' }, DEFAULTS), /VUS/)
  assert.throws(() => loadProfile({ VUS: 'many' }, DEFAULTS), /VUS/)
  assert.throws(() => loadProfile({ SHAPE: 'wave' }, DEFAULTS), /SHAPE/)
  assert.throws(() => loadProfile({ DURATION: 'forever' }, DEFAULTS), /Not a duration/)
})

test('split by weights keeps the total', () => {
  assert.deepEqual(split(200, [70, 20, 10]), [140, 40, 20])
  assert.deepEqual(split(1000, [70, 20, 10]), [700, 200, 100])
  assert.deepEqual(split(5, [70, 20, 10]), [3, 1, 1])
})

test('enough accounts', () => {
  assert.doesNotThrow(() => assertAccounts(1000, 2000))
  assert.throws(() => assertAccounts(3000, 2000), /LOAD_CUSTOMERS=3000/)
})

test('exact old stages when nothing is given', () => {
  const stages = [{ duration: '30s', target: 100 }, { duration: '30s', target: 300 }]
  assert.equal(loadProfile({}, { ...DEFAULTS, stages }).stages, stages)
  assert.equal(loadProfile({ VUS: '50' }, { ...DEFAULTS, stages }).stages[0].target, 50)
  assert.equal(profileGiven({}), false)
  assert.equal(profileGiven({ SHAPE: 'spike' }), true)
})

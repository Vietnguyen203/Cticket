import { describe, expect, test } from 'vitest'
import { DEFAULT_QUEUE_FORM, queueInput, queueProblems } from './purchaseQueueForm'

describe('purchase queue fields (new event and editor)', () => {
  test('defaults: off, 100 at once, 10 minutes, all valid', () => {
    expect(DEFAULT_QUEUE_FORM).toEqual({ enabled: false, capacity: '100', minutes: '10' })
    expect(queueProblems(DEFAULT_QUEUE_FORM)).toEqual({ capacity: null, minutes: null })
  })

  test('the API limits: 1 to 10.000 people, 5 to 30 minutes', () => {
    expect(queueProblems({ enabled: true, capacity: '0', minutes: '4' })).toEqual({ capacity: 'Từ 1 đến 10.000.', minutes: 'Từ 5 đến 30 phút.' })
    expect(queueProblems({ enabled: true, capacity: '10000', minutes: '30' })).toEqual({ capacity: null, minutes: null })
    expect(queueProblems({ enabled: true, capacity: '', minutes: '1.5' }).capacity).not.toBeNull()
  })

  test('what goes to the API', () => {
    expect(queueInput({ enabled: true, capacity: '1', minutes: '15' })).toEqual({ queueEnabled: true, queueCapacity: 1, queueSessionMinutes: 15 })
  })
})

import { describe, expect, test, vi } from 'vitest'
import { ApiError } from '../api/errors'
import { buildReport, createReporter } from './clientErrors'

describe('JavaScript errors sent to the API', () => {
  test('the page keeps no query string or hash; text is cut', () => {
    const report = buildReport(new TypeError('x is undefined'), '/orders/abc?token=secret#top', 'Chrome')
    expect(report).toMatchObject({ message: 'x is undefined', page: '/orders/abc', browser: 'Chrome' })
    expect(report?.stack).toContain('x is undefined')
    expect(buildReport('a'.repeat(900), '/')?.message).toHaveLength(500)
  })

  test('API answers, extensions and empty errors are not sent', () => {
    expect(buildReport(new ApiError(500, 'INTERNAL_ERROR', 'Lỗi'), '/')).toBeNull()
    expect(buildReport({ isAxiosError: true, message: 'Network Error' }, '/')).toBeNull()
    expect(buildReport(new Error('ResizeObserver loop completed with undelivered notifications.'), '/')).toBeNull()
    const fromExtension = new Error('boom')
    fromExtension.stack = 'Error: boom\n    at x (chrome-extension://abc/content.js:1:1)'
    expect(buildReport(fromExtension, '/')).toBeNull()
    expect(buildReport('', '/')).toBeNull()
    expect(buildReport(undefined, '/')).toBeNull()
  })

  test('at most 5 per page, never the same error twice', () => {
    const send = vi.fn()
    const report = createReporter(send)
    const same = new Error('same')
    expect(report(same, '/')).toBe(true)
    expect(report(same, '/')).toBe(false)
    for (let i = 0; i < 10; i += 1) report(new Error(`error ${i}`), '/')
    expect(send).toHaveBeenCalledTimes(5)
  })
})

import { describe, expect, test } from 'vitest'
import { browserName } from './browserName'

describe('the name of a remembered browser', () => {
  test('browser and system from the user agent', () => {
    expect(browserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36')).toBe('Chrome trên Windows')
    expect(browserName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/150.0 Safari/537.36 Edg/150.0')).toBe('Edge trên Windows')
    expect(browserName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari trên iPhone / iPad')
    expect(browserName('Mozilla/5.0 (Linux; Android 15) Gecko/20100101 Firefox/140.0')).toBe('Firefox trên Android')
    expect(browserName(null)).toBe('Trình duyệt không rõ')
  })
})

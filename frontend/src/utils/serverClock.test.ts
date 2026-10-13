import { describe, expect, test } from 'vitest'
import { recordServerDate, serverNow } from './serverClock'

describe('server clock', () => {
  test('follows the server when the device clock is wrong', () => {
    const deviceNow = Date.now()
    const serverTime = new Date(deviceNow + 5 * 60_000) // device is 5 minutes late
    recordServerDate(serverTime.toUTCString(), deviceNow - 100, deviceNow + 100)
    expect(Math.abs(serverNow() - (deviceNow + 5 * 60_000))).toBeLessThan(1500)
  })

  test('ignores a missing or broken header', () => {
    const before = serverNow() - Date.now()
    recordServerDate(undefined, 0)
    recordServerDate('nonsense', 0)
    expect(Math.abs(serverNow() - Date.now() - before)).toBeLessThan(50)
  })
})

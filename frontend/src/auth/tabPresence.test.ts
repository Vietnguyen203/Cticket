import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isFreshOpen } from './tabPresence'

/** In-memory sessionStorage of one tab. */
function stubSessionStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  })
}

/** Two BroadcastChannels of the same name talk to each other (Node has them too). */
const NAME = `etp-auth-test-${Math.random()}`

beforeEach(() => stubSessionStorage())
afterEach(() => vi.unstubAllGlobals())

describe('isFreshOpen', () => {
  test('the first load with no other tab of the site open is a fresh open', async () => {
    const me = new BroadcastChannel(NAME)
    await expect(isFreshOpen(me)).resolves.toBe(true)
    me.close()
  })

  test('a reload of the same tab is not (its sessionStorage remembers it)', async () => {
    const me = new BroadcastChannel(NAME)
    await isFreshOpen(me)
    await expect(isFreshOpen(me)).resolves.toBe(false)
    me.close()
  })

  test('a new tab while another tab of the site answers is not', async () => {
    const other = new BroadcastChannel(NAME)
    other.onmessage = (event) => {
      if (event.data.type === 'ping') other.postMessage({ type: 'pong' })
    }
    const me = new BroadcastChannel(NAME)
    await expect(isFreshOpen(me)).resolves.toBe(false)
    me.close()
    other.close()
  })

  test('blocked storage or no BroadcastChannel never logs anyone out', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
    })
    await expect(isFreshOpen(new BroadcastChannel(NAME))).resolves.toBe(false)
    stubSessionStorage()
    await expect(isFreshOpen(null)).resolves.toBe(false)
  })
})

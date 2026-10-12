import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiError, networkDown, recordingAdapter, reply } from '../test/fakeHttp'
import { getAccessToken, onAccessTokenChange, refreshAccessToken, refreshHttp, setAccessToken } from './session'

const tokenReply = (token: string) => ({ success: true, data: { accessToken: token } })

beforeEach(() => {
  setAccessToken('old-token')
  vi.stubGlobal('navigator', {}) // no Web Locks unless a test adds them
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('refreshAccessToken', () => {
  test('three callers at the same moment share ONE refresh request', async () => {
    const server = recordingAdapter(async (config) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return reply(config, 200, tokenReply('new-token'))
    })
    refreshHttp.defaults.adapter = server.adapter

    const tokens = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()])

    expect(tokens).toEqual(['new-token', 'new-token', 'new-token'])
    expect(server.calls).toHaveLength(1)
    expect(server.calls[0].url).toBe('/api/v1/auth/refresh')
    expect(server.calls[0].headers['X-Auth-Transport']).toBe('cookie') // the refresh token is the httpOnly cookie
    expect(getAccessToken()).toBe('new-token')

    // Once it has finished, the next refresh is a new request.
    await refreshAccessToken()
    expect(server.calls).toHaveLength(2)
  })

  test('a refused refresh ends the session and tells the listeners', async () => {
    refreshHttp.defaults.adapter = (config) => reply(config, 401, apiError('REFRESH_TOKEN_REUSED'))
    const seen: Array<string | null> = []
    const stop = onAccessTokenChange((token) => seen.push(token))

    await expect(refreshAccessToken()).resolves.toBeNull()

    expect(getAccessToken()).toBeNull()
    expect(seen).toEqual([null])
    stop()
  })

  test('a network failure is not a logout: the error propagates and the token stays', async () => {
    refreshHttp.defaults.adapter = networkDown

    await expect(refreshAccessToken()).rejects.toThrow('Network Error')
    expect(getAccessToken()).toBe('old-token')
  })

  test('other tabs wait: the refresh runs inside the "etp-refresh" Web Lock', async () => {
    const request = vi.fn((_name: string, task: () => Promise<unknown>) => task())
    vi.stubGlobal('navigator', { locks: { request } })
    refreshHttp.defaults.adapter = (config) => reply(config, 200, tokenReply('locked-token'))

    await expect(refreshAccessToken()).resolves.toBe('locked-token')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('etp-refresh')
  })
})

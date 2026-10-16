import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getAccessToken, refreshHttp, setAccessToken } from '../auth/session'
import { apiError, fakeJwt, networkDown, recordingAdapter, reply } from '../test/fakeHttp'
import { api } from './client'
import { ApiError } from './errors'

const OLD = fakeJwt(600)
const NEW = fakeJwt(900)

/** The API: answers 200 to the new token, 401 TOKEN_EXPIRED to anything else. */
function fakeApi() {
  return recordingAdapter((config) =>
    config.headers.Authorization === `Bearer ${NEW}`
      ? reply(config, 200, { success: true, data: { url: config.url } })
      : reply(config, 401, apiError('TOKEN_EXPIRED')),
  )
}

function fakeRefresh(status = 200) {
  return recordingAdapter(async (config) => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    return status === 200
      ? reply(config, 200, { success: true, data: { accessToken: NEW } })
      : reply(config, status, apiError('INVALID_REFRESH_TOKEN'))
  })
}

beforeEach(() => {
  setAccessToken(OLD)
  vi.stubGlobal('navigator', {})
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  test('three calls get 401 together: ONE refresh, then all three are sent again with the new token', async () => {
    const server = fakeApi()
    const refresh = fakeRefresh()
    api.defaults.adapter = server.adapter
    refreshHttp.defaults.adapter = refresh.adapter

    const results = await Promise.all(['/orders/1', '/orders/2', '/tickets'].map((url) => api.get(url)))

    expect(results.map((r) => r.data.data.url)).toEqual(['/orders/1', '/orders/2', '/tickets'])
    expect(refresh.calls).toHaveLength(1)
    expect(server.calls).toHaveLength(6) // 3 refused + 3 retried
    expect(getAccessToken()).toBe(NEW)
  })

  test('if the refresh is refused, the call fails with ApiError and the session is cleared', async () => {
    api.defaults.adapter = fakeApi().adapter
    refreshHttp.defaults.adapter = fakeRefresh(401).adapter

    const failure = await api.get('/orders').catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).code).toBe('TOKEN_EXPIRED')
    expect(getAccessToken()).toBeNull()
  })

  test('a call is retried at most once', async () => {
    const server = recordingAdapter((config) => reply(config, 401, apiError('TOKEN_REVOKED')))
    const refresh = fakeRefresh()
    api.defaults.adapter = server.adapter
    refreshHttp.defaults.adapter = refresh.adapter

    await expect(api.get('/orders')).rejects.toMatchObject({ code: 'TOKEN_REVOKED' })
    expect(server.calls).toHaveLength(2)
    expect(refresh.calls).toHaveLength(1)
  })

  test('/auth calls are never refreshed around (a wrong password is just an error)', async () => {
    const refresh = fakeRefresh()
    api.defaults.adapter = (config) => reply(config, 401, apiError('INVALID_CREDENTIALS'))
    refreshHttp.defaults.adapter = refresh.adapter

    const failure = (await api.post('/auth/login', {}).catch((err: unknown) => err)) as ApiError
    expect(failure.code).toBe('INVALID_CREDENTIALS')
    expect(failure.message).toBe('Email hoặc mật khẩu không đúng.')
    expect(refresh.calls).toHaveLength(0)
  })

  test('a token about to expire is refreshed BEFORE the call (no wasted 401)', async () => {
    setAccessToken(fakeJwt(5))
    const server = fakeApi()
    api.defaults.adapter = server.adapter
    refreshHttp.defaults.adapter = fakeRefresh().adapter

    await api.get('/tickets')
    expect(server.calls).toHaveLength(1)
    expect(server.calls[0].headers.Authorization).toBe(`Bearer ${NEW}`)
  })

  test('no connection → ApiError NETWORK_ERROR with a Vietnamese message', async () => {
    api.defaults.adapter = networkDown
    const failure = (await api.get('/events').catch((err: unknown) => err)) as ApiError
    expect(failure.code).toBe('NETWORK_ERROR')
    expect(failure.message).toMatch(/Không kết nối được máy chủ/)
  })

  test('validation details become messages per form field', async () => {
    api.defaults.adapter = (config) =>
      reply(config, 400, {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request is invalid.',
          details: [
            { field: 'body.email', message: 'Invalid email address' },
            { field: 'body.password', message: 'must be at least 8 characters' },
          ],
        },
      })
    const failure = (await api.post('/auth/register', {}).catch((err: unknown) => err)) as ApiError
    expect(failure.fieldErrors()).toEqual({ email: 'Email không hợp lệ.', password: 'Cần ít nhất 8 ký tự.' })
  })

  test('schedule times: why each field was refused, in Vietnamese', () => {
    const failure = new ApiError(400, 'VALIDATION_ERROR', 'The request is invalid.', [
      { field: 'body.startAt', message: 'must be in the future' },
      { field: 'body.endAt', message: 'must be after startAt' },
      { field: 'body.salesEndAt', message: 'must not be after startAt' },
    ])
    expect(failure.fieldErrors()).toEqual({
      startAt: 'Phải là thời điểm chưa tới (giờ này đã qua).',
      endAt: 'Phải sau giờ bắt đầu.',
      salesEndAt: 'Không được sau giờ bắt đầu (để trống: đóng bán lúc bắt đầu).',
    })
  })
})

import axios, { type InternalAxiosRequestConfig } from 'axios'
import { expiresWithin } from '../auth/jwt'
import { getAccessToken, refreshAccessToken } from '../auth/session'
import { toApiError } from './errors'

/** Refresh a little before expiry rather than waste a round trip on a 401. */
const REFRESH_AHEAD_SECONDS = 15

type RetriableConfig = InternalAxiosRequestConfig & { retried?: boolean }

/**
 * The API client. Same origin as the page (/api/v1, forwarded by Vite or
 * nginx), so no CORS and no base URL to configure.
 */
export const api = axios.create({ baseURL: '/api/v1' })

// /auth/* manages tokens itself: never refresh around those calls.
const isAuthCall = (config: InternalAxiosRequestConfig) => (config.url ?? '').startsWith('/auth/')

api.interceptors.request.use(async (config) => {
  let token = getAccessToken()
  if (token && !isAuthCall(config) && expiresWithin(token, REFRESH_AHEAD_SECONDS)) {
    token = await refreshAccessToken().catch(() => token) // offline: let the call fail on its own
  }
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as RetriableConfig | undefined
    // 401 on a call that carried a token: it expired (or was revoked). Refresh ONCE, then retry.
    if (
      error.response?.status === 401 &&
      config &&
      !config.retried &&
      !isAuthCall(config) &&
      config.headers.has('Authorization')
    ) {
      config.retried = true
      const token = await refreshAccessToken().catch(() => null)
      if (token) return api.request(config)
    }
    throw toApiError(error)
  },
)

/** The `data` of the API envelope { success, data, meta }. */
export async function unwrap<T>(request: Promise<{ data: { data: T } }>): Promise<T> {
  return (await request).data.data
}

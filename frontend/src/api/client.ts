import axios, { type InternalAxiosRequestConfig } from 'axios'
import { expiresWithin } from '../auth/jwt'
import { getAccessToken, refreshAccessToken } from '../auth/session'
import { recordServerDate } from '../utils/serverClock'
import { toApiError } from './errors'

/** Refresh a little before expiry rather than waste a round trip on a 401. */
const REFRESH_AHEAD_SECONDS = 15

type RetriableConfig = InternalAxiosRequestConfig & { retried?: boolean; sentAt?: number }

/**
 * Bug review BUG-04: a call the server never answers ends after this long
 * (TIMEOUT: "the server takes too long") instead of a button spinning forever.
 */
export const REQUEST_TIMEOUT_MS = 30_000
/** Image uploads (up to 5 MB on a slow connection) get longer. */
export const UPLOAD_TIMEOUT_MS = 60_000

/**
 * The API client. Same origin as the page (/api/v1, forwarded by Vite or
 * nginx), so no CORS and no base URL to configure.
 */
export const api = axios.create({ baseURL: '/api/v1', timeout: REQUEST_TIMEOUT_MS })

// /auth/* manages tokens itself: never refresh around those calls.
const isAuthCall = (config: InternalAxiosRequestConfig) => (config.url ?? '').startsWith('/auth/')

api.interceptors.request.use(async (config) => {
  let token = getAccessToken()
  if (token && !isAuthCall(config) && expiresWithin(token, REFRESH_AHEAD_SECONDS)) {
    token = await refreshAccessToken().catch(() => token) // offline: let the call fail on its own
  }
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  ;(config as RetriableConfig).sentAt = Date.now()
  return config
})

api.interceptors.response.use(
  (response) => {
    recordServerDate(response.headers.date, (response.config as RetriableConfig).sentAt ?? Date.now())
    return response
  },
  async (error) => {
    const config = error.config as RetriableConfig | undefined
    if (error.response) recordServerDate(error.response.headers?.date, config?.sentAt ?? Date.now())
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

import axios from 'axios'

/**
 * The login session in this browser tab (docs/phase-11-web-design.md, section 5).
 *
 * - Access token (15 minutes): only in this module's memory. A script injected
 *   into the page could use it while the tab is open, but never take away a
 *   long-lived credential; a reload simply asks for a new one.
 * - Refresh token (7 days): in an httpOnly cookie set by the API. JavaScript
 *   cannot read it; the browser attaches it to /api/v1/auth requests.
 */

/** Asks the API to use the httpOnly cookie instead of the JSON body for the refresh token. */
export const COOKIE_TRANSPORT = { 'X-Auth-Transport': 'cookie' } as const

const REFRESH_URL = '/api/v1/auth/refresh'
const LOCK_NAME = 'etp-refresh'

type Listener = (token: string | null) => void

let accessToken: string | null = null
let refreshing: Promise<string | null> | null = null
const listeners = new Set<Listener>()

/** HTTP client for the refresh call only: no interceptors, so a refresh can never trigger another refresh. */
export const refreshHttp = axios.create()

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  if (token === accessToken) return
  accessToken = token
  listeners.forEach((listener) => listener(token))
}

/** Called with the new token, or null when the session ended. @returns unsubscribe */
export function onAccessTokenChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Get a new access token with the refresh cookie. ONE refresh at a time:
 *
 * - In this tab: concurrent callers share the same promise. The API rotates
 *   refresh tokens and treats a reused one as stolen (REFRESH_TOKEN_REUSED →
 *   the whole session is revoked), so two parallel refreshes would log the
 *   user out.
 * - Across tabs: they share the cookie, so the Web Locks API lets one tab
 *   refresh at a time; the next one sends the cookie that was just rotated.
 *
 * @returns the new token, or null if the session is over (the user must log in)
 * @throws on network / server errors: the session may still be fine
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= withRefreshLock(requestNewAccessToken).finally(() => {
    refreshing = null
  })
  return refreshing
}

async function requestNewAccessToken(): Promise<string | null> {
  try {
    const res = await refreshHttp.post(REFRESH_URL, {}, { headers: COOKIE_TRANSPORT })
    setAccessToken(res.data.data.accessToken)
    return accessToken
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    if (status === 401 || status === 403) {
      setAccessToken(null) // no / expired / revoked session, or disabled account
      return null
    }
    throw err
  }
}

function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  // navigator.locks exists only on HTTPS / localhost; elsewhere, refresh without it.
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  return locks ? locks.request(LOCK_NAME, task) : task()
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as authApi from '../api/auth'
import { getMe } from '../api/users'
import type { Role, User } from '../api/types'
import { AuthContext, type AuthStatus, type AuthValue } from './AuthContext'
import { decodeJwt } from './jwt'
import { getAccessToken, onAccessTokenChange, refreshAccessToken, setAccessToken } from './session'

const SESSION_EXPIRED = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'

// Tells the other tabs of this browser about a login / logout (they share the refresh cookie).
type TabMessage = { type: 'login' } | { type: 'logout' }
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('etp-auth')

const rolesOf = (token: string | null): Role[] => (token ? ((decodeJwt(token)?.roles ?? []) as Role[]) : [])

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [roles, setRoles] = useState<Role[]>(() => rolesOf(getAccessToken()))
  const [notice, setNotice] = useState<string | null>(null)
  const loggingOut = useRef(false)

  /** Start-up (and after a login in another tab): the refresh cookie gives us an access token, if any. */
  const restore = useCallback(async () => {
    try {
      const token = getAccessToken() ?? (await refreshAccessToken())
      if (!token) {
        setUser(null)
        setStatus('anonymous')
        return
      }
      setUser(await getMe())
      setStatus('authenticated')
    } catch {
      setStatus('unreachable')
    }
  }, [])

  useEffect(() => {
    // Synchronises with the API; every state update in restore() happens after an await.
    // oxlint-disable-next-line react/set-state-in-effect
    void restore()
  }, [restore])

  // The token changes on every refresh; null means the session is over.
  useEffect(
    () =>
      onAccessTokenChange((token) => {
        setRoles(rolesOf(token))
        if (token) return
        setUser(null)
        setStatus('anonymous')
        if (!loggingOut.current) setNotice(SESSION_EXPIRED)
      }),
    [],
  )

  useEffect(() => {
    if (!channel) return undefined
    const onMessage = (event: MessageEvent<TabMessage>) => {
      if (event.data.type === 'logout') {
        loggingOut.current = true
        setAccessToken(null)
        loggingOut.current = false
      } else if (event.data.type === 'login' && !getAccessToken()) {
        void restore()
      }
    }
    channel.addEventListener('message', onMessage)
    return () => channel.removeEventListener('message', onMessage)
  }, [restore])

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password)
    setAccessToken(result.accessToken)
    // The profile carries the permissions (what menus to show); fall back to the login answer.
    setUser(await getMe().catch(() => result.user))
    setStatus('authenticated')
    setNotice(null)
    channel?.postMessage({ type: 'login' } satisfies TabMessage)
  }, [])

  const logout = useCallback(async () => {
    loggingOut.current = true
    try {
      await authApi.logout()
    } catch {
      // Offline or already logged out: forget the session here anyway.
    } finally {
      setAccessToken(null)
      setUser(null)
      setStatus('anonymous')
      loggingOut.current = false
      channel?.postMessage({ type: 'logout' } satisfies TabMessage)
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      roles,
      notice,
      clearNotice: () => setNotice(null),
      login,
      logout,
      setUser,
      retry: () => {
        setStatus('loading')
        void restore()
      },
    }),
    [status, user, roles, notice, login, logout, restore],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

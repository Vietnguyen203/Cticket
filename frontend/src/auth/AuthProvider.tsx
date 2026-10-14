import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as authApi from '../api/auth'
import { getMe } from '../api/users'
import type { LoginResult, MfaChallenge, Role, User } from '../api/types'
import { AuthContext, type AuthStatus, type AuthValue } from './AuthContext'
import { decodeJwt } from './jwt'
import { isRemembered, setRemembered } from './remember'
import { getAccessToken, onAccessTokenChange, refreshAccessToken, setAccessToken, takeSessionEndReason } from './session'
import { isFreshOpen, type PresenceMessage } from './tabPresence'

const SESSION_EXPIRED = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'
const MFA_REQUIRED = 'Tài khoản của bạn cần xác thực hai lớp. Vui lòng đăng nhập lại.'

// Tells the other tabs of this browser about a login / logout (they share the refresh cookie).
type TabMessage = { type: 'login' } | { type: 'logout' } | PresenceMessage
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('etp-auth')

/**
 * The session at page load, decided ONCE (React may run start-up effects
 * twice): without "remember me", coming back after closing every tab of the
 * site ends the session (logout revokes it on the server too).
 */
let startup: Promise<string | null> | null = null
function startupToken(): Promise<string | null> {
  startup ??= (async () => {
    if (!isRemembered() && (await isFreshOpen(channel))) {
      await authApi.logout().catch(() => undefined)
      return null
    }
    return refreshAccessToken()
  })().catch((err: unknown) => {
    startup = null // unreachable API: "Thử lại" runs it again
    throw err
  })
  return startup
}

const rolesOf = (token: string | null): Role[] => (token ? ((decodeJwt(token)?.roles ?? []) as Role[]) : [])

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [roles, setRoles] = useState<Role[]>(() => rolesOf(getAccessToken()))
  const [notice, setNotice] = useState<string | null>(null)
  const loggingOut = useRef(false)

  /** Start-up (and after a login in another tab): the refresh cookie gives us an access token, if any. */
  const restore = useCallback(async (atStartup = false) => {
    try {
      const token = getAccessToken() ?? (await (atStartup ? startupToken() : refreshAccessToken()))
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
    void restore(true)
  }, [restore])

  // The token changes on every refresh; null means the session is over.
  useEffect(
    () =>
      onAccessTokenChange((token) => {
        setRoles(rolesOf(token))
        if (token) return
        setUser(null)
        setStatus('anonymous')
        if (!loggingOut.current) setNotice(takeSessionEndReason() === 'MFA_REQUIRED' ? MFA_REQUIRED : SESSION_EXPIRED)
      }),
    [],
  )

  useEffect(() => {
    if (!channel) return undefined
    const onMessage = (event: MessageEvent<TabMessage>) => {
      if (event.data.type === 'ping') {
        channel.postMessage({ type: 'pong' } satisfies TabMessage) // "this site is still open in another tab"
      } else if (event.data.type === 'logout') {
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

  /** A session obtained (password alone, or after the two-factor step): start using it. */
  const completeLogin = useCallback(async (result: LoginResult, remember: boolean) => {
    setRemembered(remember)
    setAccessToken(result.accessToken)
    // The profile carries the permissions (what menus to show); fall back to the login answer.
    setUser(await getMe().catch(() => result.user))
    setStatus('authenticated')
    setNotice(null)
    channel?.postMessage({ type: 'login' } satisfies TabMessage)
  }, [])

  /** Step 1. With two-factor (Phase 15) there is no session yet: the challenge goes to the login page. */
  const login = useCallback(
    async (email: string, password: string, remember = false): Promise<MfaChallenge | null> => {
      const result = await authApi.login(email, password, remember)
      if (authApi.isMfaChallenge(result)) return result
      await completeLogin(result, remember)
      return null
    },
    [completeLogin],
  )

  const logout = useCallback(async () => {
    loggingOut.current = true
    try {
      await authApi.logout()
    } catch {
      // Offline or already logged out: forget the session here anyway.
    } finally {
      setAccessToken(null)
      setRemembered(false)
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
      completeLogin,
      logout,
      setUser,
      refreshSession: async () => {
        if (await refreshAccessToken()) setUser(await getMe())
      },
      retry: () => {
        setStatus('loading')
        void restore(true)
      },
    }),
    [status, user, roles, notice, login, completeLogin, logout, restore],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

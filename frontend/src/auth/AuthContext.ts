import { createContext, useContext } from 'react'
import type { LoginResult, MfaChallenge, Role, User } from '../api/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unreachable'

export interface AuthValue {
  status: AuthStatus
  user: User | null
  /** From the access token: what the API authorizes with (a new role shows after the next refresh). */
  roles: Role[]
  /** e.g. "your session expired", shown once by the layout */
  notice: string | null
  clearNotice: () => void
  /**
   * remember: stay logged in for 7 days; otherwise until the site's tabs / the browser are closed.
   * Returns the two-factor challenge when a code is needed (no session yet), else null.
   */
  login: (email: string, password: string, remember?: boolean) => Promise<MfaChallenge | null>
  /** Start using a session from the two-factor step. */
  completeLogin: (result: LoginResult) => Promise<void>
  /** `notice`: a message the layout shows once afterwards (e.g. the account was deleted). */
  logout: (notice?: string) => Promise<void>
  setUser: (user: User) => void
  /** New access token + profile: picks up a role granted meanwhile (e.g. organizer approved). */
  refreshSession: () => Promise<void>
  /** Try again after the API was unreachable at start-up. */
  retry: () => void
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

import { createContext, useContext } from 'react'
import type { Role, User } from '../api/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unreachable'

export interface AuthValue {
  status: AuthStatus
  user: User | null
  /** From the access token: what the API authorizes with (a new role shows after the next refresh). */
  roles: Role[]
  /** e.g. "your session expired", shown once by the layout */
  notice: string | null
  clearNotice: () => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
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

import { COOKIE_TRANSPORT } from '../auth/session'
import { isRemembered } from '../auth/remember'
import { api, unwrap } from './client'
import type { LoginResult, TwoFactorSetup, TwoFactorStatus } from './types'

/** Phase 15: my two-factor settings (/users/me/2fa). */

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  return (await api.get('/users/me/2fa')).data.data.twoFactor
}

/** The password again, then a new secret to scan (two-factor is not on yet). */
export async function startTwoFactorSetup(password: string): Promise<TwoFactorSetup> {
  return (await api.post('/users/me/2fa/setup', { password })).data.data.setup
}

/**
 * The first code: two-factor on. The API ends every other session and opens
 * a new one for this browser: a new access token, and a new refresh cookie
 * (kept for 7 days again if "remember me" was chosen).
 */
export function confirmTwoFactorSetup(code: string): Promise<LoginResult & { recoveryCodes: string[] }> {
  const headers = isRemembered() ? { ...COOKIE_TRANSPORT, 'X-Auth-Remember': '1' } : COOKIE_TRANSPORT
  return unwrap(api.post('/users/me/2fa/confirm', { code }, { headers }))
}

export async function disableTwoFactor(password: string, code: string): Promise<TwoFactorStatus> {
  return (await api.post('/users/me/2fa/disable', { password, code })).data.data.twoFactor
}

/** A new set of 10 recovery codes; the old ones stop working. */
export async function regenerateRecoveryCodes(code: string): Promise<string[]> {
  return (await api.post('/users/me/2fa/recovery-codes', { code })).data.data.recoveryCodes
}

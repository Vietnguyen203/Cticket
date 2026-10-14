import { COOKIE_TRANSPORT } from '../auth/session'
import { api, unwrap } from './client'
import type { LoginResult, MfaChallenge, OtpPurpose, TwoFactorSetup, User } from './types'

export interface RegisterInput {
  email: string
  password: string
  firstName: string
  lastName: string
  phone?: string
}

/**
 * The refresh token comes back as an httpOnly cookie, not in the body:
 * for 7 days with `remember`, otherwise until the browser is closed.
 */
export function login(email: string, password: string, remember = false): Promise<LoginResult | MfaChallenge> {
  return unwrap(api.post('/auth/login', { email, password, remember }, { headers: COOKIE_TRANSPORT }))
}

export const isMfaChallenge = (result: LoginResult | MfaChallenge): result is MfaChallenge => 'mfaToken' in result

/** Login step 2: a 6-digit code from the app, or a recovery code. "Remember me" was chosen at step 1. */
export function verifyLoginCode(mfaToken: string, answer: { code: string } | { recoveryCode: string }): Promise<LoginResult> {
  return unwrap(api.post('/auth/login/2fa', { mfaToken, ...answer }, { headers: COOKIE_TRANSPORT }))
}

/** An admin without two-factor: a new secret to scan. */
export async function startLoginSetup(mfaToken: string): Promise<TwoFactorSetup> {
  return (await api.post('/auth/login/2fa/setup', { mfaToken })).data.data.setup
}

/** The first code: two-factor on; the session, and 10 recovery codes shown once. */
export function confirmLoginSetup(mfaToken: string, code: string): Promise<LoginResult & { recoveryCodes: string[] }> {
  return unwrap(api.post('/auth/login/2fa/setup/confirm', { mfaToken, code }, { headers: COOKIE_TRANSPORT }))
}

/** Revokes the session (cookie) and the current access token; the API clears the cookie. */
export async function logout(): Promise<void> {
  await api.post('/auth/logout', {}, { headers: COOKIE_TRANSPORT })
}

/** Creates the account and emails a 6-digit verification code. */
export function register(input: RegisterInput): Promise<{ user: User }> {
  return unwrap(api.post('/auth/register', input))
}

/** Always "accepted": the API never reveals whether the email has an account. */
export async function requestOtp(email: string, purpose: OtpPurpose): Promise<void> {
  await api.post('/auth/otp', { email, purpose })
}

export async function verifyEmail(email: string, otp: string): Promise<void> {
  await api.post('/auth/otp/verify', { purpose: 'EMAIL_VERIFICATION', email, otp })
}

export async function resetPassword(email: string, otp: string, newPassword: string): Promise<void> {
  await api.post('/auth/otp/verify', { purpose: 'PASSWORD_RESET', email, otp, newPassword })
}

import { COOKIE_TRANSPORT } from '../auth/session'
import { api, unwrap } from './client'
import type { LoginResult, OtpPurpose, User } from './types'

export interface RegisterInput {
  email: string
  password: string
  firstName: string
  lastName: string
  phone?: string
}

/** The refresh token comes back as an httpOnly cookie, not in the body. */
export function login(email: string, password: string): Promise<LoginResult> {
  return unwrap(api.post('/auth/login', { email, password }, { headers: COOKIE_TRANSPORT }))
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

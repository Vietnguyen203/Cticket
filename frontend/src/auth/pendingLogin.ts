/**
 * Email + password typed at sign-up (or at a login refused because the email
 * is not verified yet), so the user is logged in right after entering the
 * code. Memory only: never written to storage or browser history, gone on reload.
 */
let pending: { email: string; password: string } | null = null

export function rememberPendingLogin(email: string, password: string): void {
  pending = { email, password }
}

/** Returns the credentials for this email once, then forgets them. */
export function takePendingLogin(email: string): { email: string; password: string } | null {
  const found = pending?.email === email ? pending : null
  pending = null
  return found
}

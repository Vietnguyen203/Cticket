/**
 * What auth pages hand to each other through the router's `state` (kept in
 * the browser's session history, never in the URL: an email address does not
 * belong in addresses that end up in history, logs and screenshots).
 */
export interface AuthPageState {
  email?: string
  /** After a login: where to go (a path on this site). */
  next?: string
  /** One-off message for the login page. */
  flash?: 'verified' | 'reset'
}

export function authState(value: unknown): AuthPageState {
  return value && typeof value === 'object' ? (value as AuthPageState) : {}
}

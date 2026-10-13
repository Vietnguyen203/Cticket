/**
 * "Ghi nhớ đăng nhập": a per-browser preference (not a secret), so plain
 * localStorage is fine. Storage may be blocked (private mode…): then the
 * session simply is not remembered.
 */
const KEY = 'etp-remember'

export function isRemembered(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setRemembered(remember: boolean): void {
  try {
    if (remember) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // storage unavailable: nothing to remember
  }
}

/**
 * Phase 23: JavaScript errors of this page are sent to the API
 * (POST /api/v1/client-errors), for the "Tình trạng hệ thống" page.
 *
 * - Nothing personal: the message, the stack, the path WITHOUT query string
 *   or hash, the browser. No user, no form content.
 * - At most 5 per page load, never the same error twice.
 * - sendBeacon: does not hold the page, works while it unloads; same origin,
 *   so the CSP (connect-src 'self') allows it.
 * - Not sent: API answers (ApiError: the API logs those itself), browser
 *   extensions' errors, and the browser's harmless ResizeObserver notice.
 */
export const CLIENT_ERRORS_ENDPOINT = '/api/v1/client-errors'
const MAX_PER_PAGE = 5

export interface ClientErrorReport {
  message: string
  stack?: string
  page: string
  browser?: string
  release?: string
}

type Send = (report: ClientErrorReport) => void

const IGNORED = [/ResizeObserver loop/i, /chrome-extension:\/\//, /moz-extension:\/\//, /safari-extension:\/\//]

/** What would be sent for this error, or null when it is not worth sending. */
export function buildReport(error: unknown, pathname: string, userAgent = ''): ClientErrorReport | null {
  if (error && typeof error === 'object' && ((error as { name?: string }).name === 'ApiError' || 'isAxiosError' in error)) return null
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim()
  if (!message) return null
  const stack = error instanceof Error && error.stack ? error.stack.slice(0, 4000) : undefined
  if (IGNORED.some((pattern) => pattern.test(message) || (stack && pattern.test(stack)))) return null
  return {
    message: message.slice(0, 500),
    stack,
    page: pathname.split(/[?#]/)[0] || '/',
    browser: userAgent.slice(0, 300) || undefined,
    release: import.meta.env.VITE_RELEASE || undefined,
  }
}

function beacon(report: ClientErrorReport) {
  const body = JSON.stringify(report)
  try {
    if (navigator.sendBeacon?.(CLIENT_ERRORS_ENDPOINT, new Blob([body], { type: 'application/json' }))) return
  } catch {
    // fall back to fetch
  }
  fetch(CLIENT_ERRORS_ENDPOINT, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => {})
}

/** A reporter with its own page budget (one per page load; tests make their own). */
export function createReporter(send: Send = beacon) {
  const seen = new Set<string>()
  return function report(error: unknown, pathname = window.location.pathname): boolean {
    if (seen.size >= MAX_PER_PAGE) return false
    const built = buildReport(error, pathname, navigator.userAgent)
    if (!built) return false
    const key = `${built.message}\n${built.stack?.split('\n')[1] ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    send(built)
    return true
  }
}

export const reportClientError = createReporter()

/** Listen for errors nobody caught (main.tsx, once). */
export function installErrorReporting() {
  window.addEventListener('error', (event) => reportClientError(event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => reportClientError(event.reason))
}

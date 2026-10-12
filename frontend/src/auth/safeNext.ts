/**
 * Where to go after logging in (?next=…): only a path on this site. "//evil.com"
 * and "/\evil.com" are read by browsers as another host, so they are refused too.
 */
export function safeNext(next: string | null): string {
  return next && /^\/(?![/\\])/.test(next) ? next : '/'
}

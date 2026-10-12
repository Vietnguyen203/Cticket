/** What the web reads from an access token. The signature is the server's business, not ours. */
export interface AccessClaims {
  sub: string
  roles: string[]
  /** Expiry, in seconds since 1970 */
  exp: number
}

/** Decode the payload of a JWT (base64url JSON). Never trust it for security: the API checks the signature. */
export function decodeJwt(token: string): AccessClaims | null {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(json, (char) => char.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes))
    return typeof claims.sub === 'string' && typeof claims.exp === 'number'
      ? { sub: claims.sub, exp: claims.exp, roles: Array.isArray(claims.roles) ? claims.roles : [] }
      : null
  } catch {
    return null
  }
}

/** True if the token expires within `seconds` (a token we cannot read is left to the server). */
export function expiresWithin(token: string, seconds: number, now = Date.now()): boolean {
  const claims = decodeJwt(token)
  return claims !== null && claims.exp * 1000 - now < seconds * 1000
}

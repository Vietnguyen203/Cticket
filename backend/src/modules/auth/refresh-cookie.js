const env = require('../../config/env');

/**
 * Refresh token in an httpOnly cookie, for the web app (Phase 11).
 *
 * A browser cannot keep a secret from its own page: localStorage is readable
 * by any script that runs there, including an injected one (XSS). An
 * httpOnly cookie is not readable by JavaScript at all; the browser only
 * attaches it to requests to /api/v1/auth.
 *
 * Opt-in per request with the header `X-Auth-Transport: cookie`. Without it
 * nothing changes (token in the JSON body, as Postman and API clients use it).
 * The header is also half of the CSRF defence: a form on another site cannot
 * add a header, and a cross-site fetch with one needs a CORS preflight that
 * this API refuses. The other half is SameSite=Strict.
 */
const COOKIE_NAME = 'etp_refresh';
const COOKIE_PATH = '/api/v1/auth';
const TRANSPORT_HEADER = 'x-auth-transport';
const DAY_MS = 24 * 60 * 60 * 1000;

// Browsers accept Secure cookies on http://localhost, so production can always require HTTPS.
const secure = env.REFRESH_COOKIE_SECURE ?? env.NODE_ENV === 'production';

const cookieOptions = () => ({ httpOnly: true, sameSite: 'strict', secure, path: COOKIE_PATH });

function usesCookie(req) {
  return req.get(TRANSPORT_HEADER) === 'cookie';
}

/** The refresh cookie's value, or undefined. Read only for requests that opted in (CSRF). */
function readRefreshCookie(req) {
  if (!usesCookie(req)) return undefined;
  for (const pair of (req.get('cookie') ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator > 0 && pair.slice(0, separator).trim() === COOKIE_NAME) {
      return pair.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

function setRefreshCookie(res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS });
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

module.exports = { COOKIE_NAME, COOKIE_PATH, usesCookie, readRefreshCookie, setRefreshCookie, clearRefreshCookie };

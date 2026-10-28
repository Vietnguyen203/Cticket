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
// The refresh cookie has no expiry (a session cookie): closing the browser
// ends the session, always. "Ghi nhớ đăng nhập" is the device cookie below.
// The device cookie: this browser passed the two-factor step with
// "Ghi nhớ đăng nhập" ticked (trusted-devices.js). Same path, same flags.
const DEVICE_COOKIE_NAME = 'etp_device';
const DAY_MS = 24 * 60 * 60 * 1000;

// Browsers accept Secure cookies on http://localhost, so production can always require HTTPS.
const secure = env.REFRESH_COOKIE_SECURE ?? env.NODE_ENV === 'production';

const cookieOptions = () => ({ httpOnly: true, sameSite: 'strict', secure, path: COOKIE_PATH });

function usesCookie(req) {
  return req.get(TRANSPORT_HEADER) === 'cookie';
}

/** A cookie's value, or undefined. Read only for requests that opted in (CSRF). */
function readCookie(req, name) {
  if (!usesCookie(req)) return undefined;
  for (const pair of (req.get('cookie') ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator > 0 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

const readRefreshCookie = (req) => readCookie(req, COOKIE_NAME);
const readDeviceCookie = (req) => readCookie(req, DEVICE_COOKIE_NAME);

/** Always a session cookie: no Max-Age, the browser drops it when it closes. */
function setRefreshCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

/** Kept TRUSTED_DEVICE_DAYS: survives closing the browser (the session does not). */
function setDeviceCookie(res, token, days) {
  res.cookie(DEVICE_COOKIE_NAME, token, { ...cookieOptions(), maxAge: days * DAY_MS });
}

function clearDeviceCookie(res) {
  res.clearCookie(DEVICE_COOKIE_NAME, cookieOptions());
}

module.exports = {
  COOKIE_NAME,
  COOKIE_PATH,
  usesCookie,
  DEVICE_COOKIE_NAME,
  readRefreshCookie,
  readDeviceCookie,
  setRefreshCookie,
  clearRefreshCookie,
  setDeviceCookie,
  clearDeviceCookie,
};

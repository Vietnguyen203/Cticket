const env = require('../../config/env');
const { redis, tryRedis } = require('../../redis/client');

/**
 * Access tokens are stateless JWTs (valid up to JWT_ACCESS_TTL_SECONDS).
 * The denylist makes them stop working immediately when needed:
 *  - deny:jti:{jti}     this one token was logged out (TTL = its remaining life)
 *  - deny:user:{userId} every token of the user issued BEFORE this second
 *                       (password reset; later: suspension, role change)
 * Entries never outlive the tokens they block, so Redis stays small.
 */
const jtiKey = (jti) => `deny:jti:${jti}`;
const userKey = (userId) => `deny:user:${userId}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Logout: block this access token until it would have expired anyway. */
async function revokeToken({ jti, expiresAt }) {
  const ttl = expiresAt - nowSeconds();
  if (!jti || ttl <= 0) return;
  await tryRedis('revoke access token', () => redis.set(jtiKey(jti), '1', 'EX', ttl), null);
}

/** Password reset: block every access token of the user issued so far. */
async function revokeAllTokensOfUser(userId) {
  await tryRedis(
    'revoke all access tokens of a user',
    () => redis.set(userKey(userId), String(nowSeconds()), 'EX', env.JWT_ACCESS_TTL_SECONDS),
    null,
  );
}

/**
 * One MGET per authenticated request. If Redis is down the check is skipped:
 * the token is still verified (signature, expiry), it just cannot be revoked
 * early for that moment.
 */
async function isRevoked({ jti, id, issuedAt }) {
  const [blocked, cutoff] = await tryRedis('denylist check', () => redis.mget(jtiKey(jti), userKey(id)), [null, null]);
  // Same-second tokens are kept: iat has 1 s resolution, and a login right
  // after a password reset must keep working.
  return blocked !== null || (cutoff !== null && issuedAt < Number(cutoff));
}

module.exports = { revokeToken, revokeAllTokensOfUser, isRevoked };

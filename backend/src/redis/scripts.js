/**
 * Lua scripts. Redis runs a script start to finish without running any other
 * command in between, so each one is an atomic check-and-update, the Redis
 * counterpart of a conditional UPDATE in PostgreSQL.
 */
const SCRIPTS = {
  /**
   * Fixed-window rate limit counter.
   * KEYS[1] counter; ARGV[1] window in ms.
   * Returns { count in this window, ms until the window resets }.
   */
  rateLimitHit: {
    numberOfKeys: 1,
    lua: `
      local count = redis.call('INCR', KEYS[1])
      local ttl = redis.call('PTTL', KEYS[1])
      if count == 1 or ttl < 0 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
        ttl = tonumber(ARGV[1])
      end
      return { count, ttl }
    `,
  },

  /**
   * Issue an OTP code unless the resend cooldown or the hourly cap applies.
   * KEYS: [code hash, cooldown, hourly counter]
   * ARGV: [code hash, code ttl s, cooldown s, hour s, max per hour]
   * Returns 1 if issued (the previous code is replaced), 0 if refused.
   */
  otpIssue: {
    numberOfKeys: 3,
    lua: `
      if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
      if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[5]) then return 0 end
      redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
      if redis.call('INCR', KEYS[3]) == 1 then redis.call('EXPIRE', KEYS[3], ARGV[4]) end
      redis.call('DEL', KEYS[1])
      redis.call('HSET', KEYS[1], 'hash', ARGV[1], 'attempts', 0)
      redis.call('EXPIRE', KEYS[1], ARGV[2])
      return 1
    `,
  },

  /**
   * Check a code. Right: delete it (single use) and return 1. Wrong: count the
   * attempt, delete the code at the limit, return 0. No code: 0.
   * KEYS: [code hash]; ARGV: [hash of the submitted code, max attempts]
   * (Comparing HMACs with == leaks timing only about the HMAC, which an
   * attacker cannot use without the server key.)
   */
  otpConsume: {
    numberOfKeys: 1,
    lua: `
      local stored = redis.call('HGET', KEYS[1], 'hash')
      if not stored then return 0 end
      if stored == ARGV[1] then
        redis.call('DEL', KEYS[1])
        return 1
      end
      if redis.call('HINCRBY', KEYS[1], 'attempts', 1) >= tonumber(ARGV[2]) then
        redis.call('DEL', KEYS[1])
      end
      return 0
    `,
  },

  /**
   * Lock every seat or none. KEYS: seat lock keys; ARGV: [owner, ttl ms].
   * Returns 0 when all were locked, else the 1-based index of a seat that is
   * already locked by someone else.
   */
  seatLock: {
    lua: `
      for i, key in ipairs(KEYS) do
        if redis.call('EXISTS', key) == 1 then return i end
      end
      for _, key in ipairs(KEYS) do
        redis.call('SET', key, ARGV[1], 'PX', ARGV[2])
      end
      return 0
    `,
  },

  /**
   * Delete only the locks still owned by ARGV[1]: a lock that expired and was
   * taken by another request must not be deleted by the old owner.
   */
  seatUnlock: {
    lua: `
      local released = 0
      for _, key in ipairs(KEYS) do
        if redis.call('GET', key) == ARGV[1] then
          redis.call('DEL', key)
          released = released + 1
        end
      end
      return released
    `,
  },
};

module.exports = { SCRIPTS };

/**
 * Lua scripts. Redis runs a script start to finish without running any other
 * command in between, so each one is an atomic check-and-update, the Redis
 * counterpart of a conditional UPDATE in PostgreSQL.
 */
// ---------------------------------------------------------------------------
// Phase 21: purchase queue. KEYS: [active, waiting, seq] of one event.
//   active:  ZSET userId → end of their turn (ms)
//   waiting: ZSET userId → ticket number (from seq), so the rank is the place in the queue
// ARGV: [userId ('' for none), capacity, turn length ms, key ttl s]. The time
// comes from Redis (TIME), so several API instances agree on it.
//
// Every queue script starts with ADMIT: drop the turns that ran out, then let
// the head of the queue in while there is room. The newcomer is placed only
// after that, so they never get in ahead of someone already waiting.
// They all return { state, turn end ms, place, now ms, ...user ids let in }
// (state 0 none, 1 active, 2 waiting).
// ---------------------------------------------------------------------------
const QUEUE_ADMIT = `
  local t = redis.call('TIME')
  local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  local capacity = tonumber(ARGV[2])
  local turn = tonumber(ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
  local admitted = {}
  while redis.call('ZCARD', KEYS[1]) < capacity do
    local head = redis.call('ZPOPMIN', KEYS[2])
    if #head == 0 then break end
    redis.call('ZADD', KEYS[1], now + turn, head[1])
    admitted[#admitted + 1] = head[1]
  end
  local function reply(state, ends, place)
    for _, key in ipairs(KEYS) do redis.call('EXPIRE', key, ARGV[4]) end
    local out = { state, ends, place, now }
    for _, id in ipairs(admitted) do out[#out + 1] = id end
    return out
  end
  local function where(user)
    local ends = redis.call('ZSCORE', KEYS[1], user)
    if ends then return 1, tonumber(ends), 0 end
    local rank = redis.call('ZRANK', KEYS[2], user)
    if rank then return 2, 0, rank + 1 end
    return 0, 0, 0
  end
`;

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

  /** Phase 21: join the queue (again): a turn now, or a place at the end; someone already in keeps theirs. */
  queueJoin: {
    numberOfKeys: 3,
    lua: `${QUEUE_ADMIT}
      local state, ends, place = where(ARGV[1])
      if state ~= 0 then return reply(state, ends, place) end
      if redis.call('ZCARD', KEYS[2]) == 0 and redis.call('ZCARD', KEYS[1]) < capacity then
        redis.call('ZADD', KEYS[1], now + turn, ARGV[1])
        return reply(1, now + turn, 0)
      end
      redis.call('ZADD', KEYS[2], 'NX', redis.call('INCR', KEYS[3]), ARGV[1])
      return reply(2, 0, redis.call('ZRANK', KEYS[2], ARGV[1]) + 1)
    `,
  },

  /** Phase 21: where someone is (state 0 when not in the queue). ARGV[1] '' only admits. */
  queueStatus: {
    numberOfKeys: 3,
    lua: `${QUEUE_ADMIT}
      if ARGV[1] == '' then return reply(0, 0, 0) end
      local state, ends, place = where(ARGV[1])
      return reply(state, ends, place)
    `,
  },

  /** Phase 21: leave (turn or place), then let the next people in. */
  queueLeave: {
    numberOfKeys: 3,
    lua: `
      redis.call('ZREM', KEYS[1], ARGV[1])
      redis.call('ZREM', KEYS[2], ARGV[1])
      ${QUEUE_ADMIT}
      return reply(0, 0, 0)
    `,
  },

  /**
   * Phase 21: a turn lasts at least until ARGV[2] (ms): the end of the hold /
   * payment window of the order its owner just made. Never shortened.
   * KEYS: [active]. Returns 1 if the person had a turn.
   */
  queueExtend: {
    numberOfKeys: 1,
    lua: `
      if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end
      redis.call('ZADD', KEYS[1], 'XX', 'GT', ARGV[2], ARGV[1])
      return 1
    `,
  },

  /** Phase 21: does ARGV[1] have a turn right now? KEYS: [active]. */
  queueHasTurn: {
    numberOfKeys: 1,
    lua: `
      local ends = redis.call('ZSCORE', KEYS[1], ARGV[1])
      if not ends then return 0 end
      local t = redis.call('TIME')
      return tonumber(ends) > tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000) and 1 or 0
    `,
  },
};

module.exports = { SCRIPTS };

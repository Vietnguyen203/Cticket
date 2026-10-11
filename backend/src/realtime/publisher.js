const env = require('../config/env');
const { redis, tryRedis } = require('../redis/client');

/**
 * Every API instance subscribes to this one channel and forwards each message
 * to its own sockets in the target room (WS-05). Pub/Sub channels ignore the
 * Redis database number, hence the environment in the name: tests (database
 * 15) never reach the sockets of a development server sharing that Redis.
 */
const CHANNEL = `etp:realtime:${env.NODE_ENV}`;

// Hubs running in this process (normally one; tests start several).
const localHubs = new Set();

function registerHub(hub) {
  localHubs.add(hub);
}

function unregisterHub(hub) {
  localHubs.delete(hub);
}

/**
 * Send `message` to every socket in `room`, on every API instance.
 * If Redis is unavailable, the sockets connected to THIS process still get
 * it; clients on other instances miss it and resync from the REST seat map.
 */
async function publish(room, message) {
  const sent = await tryRedis('realtime publish', () => redis.publish(CHANNEL, JSON.stringify({ room, message })), null);
  if (sent === null) {
    for (const hub of localHubs) hub.deliver(room, message);
  }
}

/**
 * Publish once the caller's transaction has committed: a rolled-back
 * booking must never show up as a held seat. Outside withTransaction
 * (autocommit query), the change is already saved, so publish right away.
 * @param {{ afterCommit?: (fn: () => Promise<void>) => void }} db
 */
function publishAfterCommit(db, room, message) {
  const send = () => publish(room, message);
  if (typeof db.afterCommit === 'function') {
    db.afterCommit(send);
    return undefined;
  }
  return send();
}

module.exports = { CHANNEL, publish, publishAfterCommit, registerHub, unregisterHub };

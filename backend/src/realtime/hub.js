const { WebSocketServer, WebSocket } = require('ws');
const env = require('../config/env');
const logger = require('../utils/logger');
const { redis } = require('../redis/client');
const { verifyAccessToken, isRevoked } = require('../modules/auth');
const events = require('../modules/events');
const { CHANNEL, registerHub, unregisterHub } = require('./publisher');
const { scheduleRoom, userRoom } = require('./messages');

const PATH = '/ws';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSE_GOING_AWAY = 1001; // "server restarting": clients reconnect, maybe to another instance
const CLOSE_POLICY_VIOLATION = 1008;
const SHUTDOWN_GRACE_MS = 200;

/** See docs/phase-7-websocket-design.md, section 6. */
const DEFAULT_LIMITS = Object.freeze({
  maxMessageBytes: 4 * 1024,
  maxSubscriptions: 5,
  maxMessages: 20,
  messageWindowMs: 10_000,
  maxConnectionsPerIp: 20,
});

/** The client IP, honouring TRUST_PROXY the same way Express does for req.ip. */
function clientIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const chain = [...forwarded, req.socket.remoteAddress];
  return chain[Math.max(0, chain.length - 1 - env.TRUST_PROXY)];
}

/** Browsers send Origin: only listed web origins may connect. Apps send none and are allowed. */
function originAllowed(req) {
  const { origin } = req.headers;
  return !origin || env.CORS_ORIGINS.includes(origin);
}

function rejectUpgrade(socket, status, reason) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * WebSocket endpoint at /ws on the API's HTTP server (WS-01..WS-05).
 *
 * The socket only CARRIES notifications; every action still goes through the
 * REST API and PostgreSQL. Rooms: schedule:{id} (anyone, live seat map) and
 * user:{id} (after AUTH, personal notifications).
 */
class RealtimeHub {
  constructor({ heartbeatMs = env.WS_HEARTBEAT_SECONDS * 1000, limits = {} } = {}) {
    this.heartbeatMs = heartbeatMs;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.rooms = new Map(); // room → Set<connection>
    this.connections = new Set();
    this.connectionsPerIp = new Map();
  }

  /** Start serving WebSocket upgrades on `server` and listening to the Redis channel. */
  async attach(server) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: this.limits.maxMessageBytes });
    this.onUpgrade = (req, socket, head) => this.handleUpgrade(req, socket, head);
    server.on('upgrade', this.onUpgrade);
    this.server = server;

    this.heartbeat = setInterval(() => this.checkHeartbeats(), this.heartbeatMs);
    this.heartbeat.unref();

    // A subscribed Redis connection cannot run other commands: use its own.
    // No command timeout here: the first connect may take longer than 200 ms,
    // and ioredis re-subscribes by itself after a reconnect.
    this.subscriber = redis.duplicate({ commandTimeout: undefined });
    this.subscriber.on('error', () => {}); // logged by the main client; delivery degrades to local
    this.subscriber.on('message', (channel, payload) => {
      try {
        const { room, message } = JSON.parse(payload);
        this.deliver(room, message);
      } catch (err) {
        logger.warn({ err }, 'Ignoring malformed realtime message');
      }
    });
    try {
      await this.subscriber.subscribe(CHANNEL);
    } catch (err) {
      logger.warn({ err }, 'Realtime: Redis subscribe failed; only local delivery until it reconnects');
    }
    registerHub(this);
  }

  handleUpgrade(req, socket, head) {
    if (new URL(req.url, 'http://localhost').pathname !== PATH) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (!originAllowed(req)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const ip = clientIp(req);
    if ((this.connectionsPerIp.get(ip) ?? 0) >= this.limits.maxConnectionsPerIp) {
      rejectUpgrade(socket, 429, 'Too Many Requests');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, ip));
  }

  onConnection(ws, ip) {
    const conn = { ws, ip, alive: true, user: null, authTimer: null, rooms: new Set(), recentMessages: [] };
    this.connections.add(conn);
    this.connectionsPerIp.set(ip, (this.connectionsPerIp.get(ip) ?? 0) + 1);

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data) => {
      this.onMessage(conn, data).catch((err) => {
        logger.error({ err }, 'Realtime message handler failed');
        this.send(conn, { type: 'ERROR', code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
      });
    });
    ws.on('close', () => this.cleanup(conn));
    ws.on('error', (err) => logger.debug({ err }, 'WebSocket error'));

    this.send(conn, { type: 'WELCOME', heartbeatSeconds: Math.round(this.heartbeatMs / 1000) });
  }

  async onMessage(conn, data) {
    if (this.tooManyMessages(conn)) {
      conn.ws.close(CLOSE_POLICY_VIOLATION, 'Too many messages');
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this.sendError(conn, 'BAD_MESSAGE', 'Messages must be JSON.');
      return;
    }
    switch (message?.type) {
      case 'AUTH':
        await this.authenticate(conn, message.token);
        break;
      case 'SUBSCRIBE':
        await this.subscribe(conn, message.scheduleId);
        break;
      case 'UNSUBSCRIBE':
        this.leave(conn, scheduleRoom(message.scheduleId));
        this.send(conn, { type: 'UNSUBSCRIBED', scheduleId: message.scheduleId });
        break;
      default:
        this.sendError(conn, 'BAD_MESSAGE', 'Unknown message type. Use AUTH, SUBSCRIBE or UNSUBSCRIBE.');
    }
  }

  /** Same checks as REST: signature, expiry, and the logout denylist. */
  async authenticate(conn, token) {
    let user;
    try {
      user = verifyAccessToken(String(token ?? ''));
      if (await isRevoked(user)) {
        this.sendError(conn, 'TOKEN_REVOKED', 'This session has ended. Please log in again.');
        return;
      }
    } catch (err) {
      this.sendError(conn, err.code ?? 'UNAUTHENTICATED', 'The access token is invalid or has expired.');
      return;
    }

    if (conn.user && conn.user.id !== user.id) this.leave(conn, userRoom(conn.user.id));
    conn.user = user;
    this.join(conn, userRoom(user.id));

    // Personal notifications stop when the token expires; the client re-sends AUTH with a fresh one.
    clearTimeout(conn.authTimer);
    conn.authTimer = setTimeout(() => {
      this.leave(conn, userRoom(user.id));
      conn.user = null;
      this.send(conn, { type: 'AUTH_EXPIRED' });
    }, Math.max(0, user.expiresAt * 1000 - Date.now()));
    conn.authTimer.unref();

    this.send(conn, { type: 'AUTH_OK', userId: user.id, expiresAt: new Date(user.expiresAt * 1000).toISOString() });
  }

  async subscribe(conn, scheduleId) {
    if (typeof scheduleId !== 'string' || !UUID_PATTERN.test(scheduleId)) {
      this.sendError(conn, 'BAD_MESSAGE', 'scheduleId must be a UUID.');
      return;
    }
    const room = scheduleRoom(scheduleId);
    if (conn.rooms.has(room)) {
      this.send(conn, { type: 'SUBSCRIBED', scheduleId });
      return;
    }
    const watched = [...conn.rooms].filter((name) => name.startsWith('schedule:')).length;
    if (watched >= this.limits.maxSubscriptions) {
      this.sendError(conn, 'SUBSCRIPTION_LIMIT', `At most ${this.limits.maxSubscriptions} schedules per connection.`);
      return;
    }
    if (!(await events.findWatchableSchedule(scheduleId))) {
      this.sendError(conn, 'NOT_FOUND', 'Schedule not found or not on sale.');
      return;
    }
    this.join(conn, room);
    // The client loads the REST seat map AFTER this, then applies newer versions.
    this.send(conn, { type: 'SUBSCRIBED', scheduleId });
  }

  tooManyMessages(conn) {
    const now = Date.now();
    conn.recentMessages = conn.recentMessages.filter((time) => now - time < this.limits.messageWindowMs);
    conn.recentMessages.push(now);
    return conn.recentMessages.length > this.limits.maxMessages;
  }

  join(conn, room) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room).add(conn);
    conn.rooms.add(room);
  }

  leave(conn, room) {
    const members = this.rooms.get(room);
    if (members) {
      members.delete(conn);
      if (members.size === 0) this.rooms.delete(room);
    }
    conn.rooms.delete(room);
  }

  cleanup(conn) {
    if (!this.connections.delete(conn)) return;
    clearTimeout(conn.authTimer);
    for (const room of [...conn.rooms]) this.leave(conn, room);
    const left = (this.connectionsPerIp.get(conn.ip) ?? 1) - 1;
    if (left > 0) this.connectionsPerIp.set(conn.ip, left);
    else this.connectionsPerIp.delete(conn.ip);
  }

  /** Ping everyone; whoever did not answer the previous ping is gone (dead network, closed app). */
  checkHeartbeats() {
    for (const conn of this.connections) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }

  /** Send to this process's sockets in `room` (serialized once for all of them). */
  deliver(room, message) {
    const members = this.rooms.get(room);
    if (!members) return;
    const data = JSON.stringify(message);
    for (const conn of members) {
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(data);
    }
  }

  send(conn, message) {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(message));
  }

  sendError(conn, code, message) {
    this.send(conn, { type: 'ERROR', code, message });
  }

  /** Graceful shutdown: tell clients to reconnect elsewhere, then drop what is left. */
  async close() {
    unregisterHub(this);
    clearInterval(this.heartbeat);
    this.server?.off('upgrade', this.onUpgrade);
    for (const conn of this.connections) conn.ws.close(CLOSE_GOING_AWAY, 'Server restarting');
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
    for (const conn of this.connections) conn.ws.terminate();
    await new Promise((resolve) => this.wss.close(resolve));
    this.subscriber.disconnect();
  }
}

module.exports = { RealtimeHub, PATH, DEFAULT_LIMITS };

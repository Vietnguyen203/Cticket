const http = require('node:http');
const WebSocket = require('ws');
const { createApp } = require('../../src/app');
const { RealtimeHub } = require('../../src/realtime/hub');

/** A real HTTP server with the REST API and the /ws endpoint, on a random port. */
async function startServer(hubOptions = {}) {
  const app = createApp();
  const server = http.createServer(app);
  const hub = new RealtimeHub(hubOptions);
  await hub.attach(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    app,
    hub,
    url: `ws://127.0.0.1:${server.address().port}/ws`,
    async stop() {
      await hub.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Open a WebSocket and record every message.
 * waitFor(type or predicate) resolves with the next matching message that was
 * not returned before; expectNone() checks that nothing matching arrives.
 */
async function connect(url, options = {}) {
  const ws = new WebSocket(url, options);
  const messages = [];
  const used = new Set();
  const listeners = new Set();
  ws.on('message', (data) => {
    messages.push(JSON.parse(data.toString()));
    listeners.forEach((listener) => listener());
  });
  const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('unexpected-response', (req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });

  const matcher = (what) => (typeof what === 'string' ? (m) => m.type === what : what);
  const findNew = (match) => messages.findIndex((m, index) => !used.has(index) && match(m));

  return {
    ws,
    messages,
    closed,
    send: (message) => ws.send(typeof message === 'string' ? message : JSON.stringify(message)),
    waitFor(what, timeoutMs = 3000) {
      const match = matcher(what);
      return new Promise((resolve, reject) => {
        const check = () => {
          const index = findNew(match);
          if (index === -1) return;
          used.add(index);
          listeners.delete(check);
          clearTimeout(timer);
          resolve(messages[index]);
        };
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`No matching message within ${timeoutMs} ms. Got: ${JSON.stringify(messages)}`));
        }, timeoutMs);
        listeners.add(check);
        check();
      });
    },
    async expectNone(what, waitMs = 400) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const index = findNew(matcher(what));
      if (index !== -1) throw new Error(`Unexpected message: ${JSON.stringify(messages[index])}`);
    },
    close: () => ws.close(),
  };
}

module.exports = { startServer, connect };

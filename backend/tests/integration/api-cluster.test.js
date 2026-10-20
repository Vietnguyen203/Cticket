const { spawn } = require('node:child_process');
const path = require('node:path');

/**
 * Bug review follow-up (performance): `node src/server.js` with API_WORKERS=2
 * really starts two API processes on one port, each with half the PostgreSQL
 * pool, answering requests, and stops them all on SIGTERM.
 */
const PORT = 39310;

test('API_WORKERS=2: two API processes on one port, stopped together', async () => {
  const api = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, API_WORKERS: '2', PG_POOL_MAX: '10', PORT: String(PORT), LOG_LEVEL: 'info' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  let buffered = '';
  api.stdout.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) if (line.startsWith('{')) logs.push(JSON.parse(line));
  });
  const exited = new Promise((resolve) => api.on('exit', (code) => resolve(code)));

  try {
    const deadline = Date.now() + 20_000;
    let listening = [];
    while (listening.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      listening = logs.filter((entry) => entry.msg === 'API server listening');
    }
    expect(logs.find((entry) => entry.msg === 'Starting API workers')).toMatchObject({ workers: 2, pgPoolPerWorker: 5 });
    expect(listening).toHaveLength(2);
    expect(new Set(listening.map((entry) => entry.pid)).size).toBe(2);
    expect(listening.every((entry) => entry.pgPoolMax === 5 && entry.port === PORT)).toBe(true);

    const answers = await Promise.all(
      Array.from({ length: 10 }, () => fetch(`http://127.0.0.1:${PORT}/health/ready`).then((res) => res.status)),
    );
    expect(answers).toEqual(Array(10).fill(200));
  } finally {
    api.kill('SIGTERM');
  }

  const code = await exited;
  // Windows has no signals: kill() there ends the process at once.
  if (process.platform !== 'win32') {
    expect(code).toBe(0);
    expect(logs.filter((entry) => entry.msg === 'Shutdown complete')).toHaveLength(2);
    expect(logs.some((entry) => entry.msg === 'All API workers stopped')).toBe(true);
  }
}, 40_000);

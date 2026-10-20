const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

/**
 * Bug review follow-up (performance): several API processes in one container
 * (src/api-cluster.js). The node:cluster module is replaced by a fake, so the
 * primary's decisions (how many, how much pool each, restart, stop) are tested
 * without forking; tests/integration/api-cluster.test.js starts real ones.
 */
jest.mock('node:cluster', () => {
  const { EventEmitter: Emitter } = require('node:events');
  const fake = new Emitter();
  fake.workers = {};
  fake.fork = jest.fn();
  return fake;
});

const cluster = require('node:cluster');
const { startCluster, workerCount, poolPerWorker } = require('../../src/api-cluster');

describe('how many workers, how many connections each', () => {
  test("API_WORKERS: a number, or 'auto' = the CPU cores", () => {
    expect(workerCount(3, 8)).toBe(3);
    expect(workerCount('auto', 8)).toBe(8);
    expect(workerCount('auto', 0)).toBe(1);
  });

  test('PG_POOL_MAX is shared between the workers, at least 2 each', () => {
    expect(poolPerWorker(20, 1)).toBe(20);
    expect(poolPerWorker(20, 4)).toBe(5);
    expect(poolPerWorker(20, 3)).toBe(6);
    expect(poolPerWorker(20, 16)).toBe(2);
  });

  test('src/config/env.js reads API_WORKERS: default 1, a number, auto; anything else stops', () => {
    const read = (value) => {
      const env = { ...process.env, API_WORKERS: value };
      if (value === undefined) delete env.API_WORKERS;
      return spawnSync(process.execPath, ['-e', "process.stdout.write(String(require('./src/config/env').API_WORKERS))"], {
        cwd: path.resolve(__dirname, '../..'),
        env,
        encoding: 'utf8',
      });
    };
    expect(read(undefined).stdout).toBe('1');
    expect(read('4').stdout).toBe('4');
    expect(read('auto').stdout).toBe('auto');
    expect(read('0').status).toBe(1);
    expect(read('many').status).toBe(1);
  });
});

describe('the primary process', () => {
  let nextPid;
  let signals;
  let exit;

  function fakeFork() {
    const worker = new EventEmitter();
    worker.id = nextPid;
    worker.process = { pid: nextPid++, kill: jest.fn() };
    cluster.workers[worker.id] = worker;
    return worker;
  }

  function die(worker, code = 1) {
    delete cluster.workers[worker.id];
    cluster.emit('exit', worker, code, null);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    nextPid = 100;
    cluster.workers = {};
    cluster.removeAllListeners();
    cluster.fork.mockReset().mockImplementation(fakeFork);
    signals = {};
    jest.spyOn(process, 'on').mockImplementation((name, handler) => {
      signals[name] = handler;
      return process;
    });
    exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.on.mockRestore();
    exit.mockRestore();
    jest.useRealTimers();
  });

  test('forks the workers, each with its share of the PostgreSQL pool', () => {
    startCluster({ workers: 4, poolMax: 20, shutdownTimeoutMs: 1_000 });
    expect(cluster.fork).toHaveBeenCalledTimes(4);
    expect(cluster.fork).toHaveBeenCalledWith({ PG_POOL_MAX: '5', API_WORKERS: '1' });
  });

  test('a worker that dies is replaced, a second later', () => {
    startCluster({ workers: 2, poolMax: 20, shutdownTimeoutMs: 1_000 });
    die(cluster.workers[100]);
    expect(cluster.fork).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1_000);
    expect(cluster.fork).toHaveBeenCalledTimes(3);
    expect(Object.keys(cluster.workers)).toHaveLength(2);
    expect(exit).not.toHaveBeenCalled();
  });

  test('workers dying in a loop: the container stops (Docker restarts it, someone notices)', () => {
    startCluster({ workers: 1, poolMax: 20, shutdownTimeoutMs: 1_000 });
    for (let i = 0; i < 5; i++) {
      die(Object.values(cluster.workers)[0]);
      jest.advanceTimersByTime(1_000);
    }
    expect(exit).not.toHaveBeenCalled();
    die(Object.values(cluster.workers)[0]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('crashes spread over time are not a loop', () => {
    startCluster({ workers: 1, poolMax: 20, shutdownTimeoutMs: 1_000 });
    for (let i = 0; i < 8; i++) {
      die(Object.values(cluster.workers)[0]);
      jest.advanceTimersByTime(30_000);
    }
    expect(exit).not.toHaveBeenCalled();
  });

  test('SIGTERM: passed on to every worker; exits 0 once they have all stopped, without replacing them', () => {
    startCluster({ workers: 2, poolMax: 20, shutdownTimeoutMs: 1_000 });
    const [a, b] = Object.values(cluster.workers);
    signals.SIGTERM();
    signals.SIGTERM();
    expect(a.process.kill).toHaveBeenCalledTimes(1);
    expect(a.process.kill).toHaveBeenCalledWith('SIGTERM');
    expect(b.process.kill).toHaveBeenCalledWith('SIGTERM');
    die(a, 0);
    expect(exit).not.toHaveBeenCalled();
    die(b, 0);
    expect(exit).toHaveBeenCalledWith(0);
    jest.advanceTimersByTime(5_000);
    expect(cluster.fork).toHaveBeenCalledTimes(2);
  });

  test('a worker stuck in its shutdown: forced exit after the shutdown timeout', () => {
    startCluster({ workers: 2, poolMax: 20, shutdownTimeoutMs: 1_000 });
    signals.SIGINT();
    expect(Object.values(cluster.workers)[0].process.kill).toHaveBeenCalledWith('SIGINT');
    jest.advanceTimersByTime(2_000);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

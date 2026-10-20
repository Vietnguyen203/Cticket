const { spawnSync } = require('node:child_process');
const path = require('node:path');

/**
 * Bug review BUG-05: src/config/env.js read in a fresh process (it stops the
 * process on a bad configuration), with the test environment plus `overrides`
 * (undefined removes a variable).
 */
function startWith(overrides) {
  const env = { ...process.env, ...overrides };
  for (const [name, value] of Object.entries(overrides)) if (value === undefined) delete env[name];
  return spawnSync(process.execPath, ['-e', "require('./src/config/env')"], {
    cwd: path.resolve(__dirname, '../..'),
    env,
    encoding: 'utf8',
  });
}

describe('two-factor for admins in production (BUG-05)', () => {
  test('refused: production without ADMIN in TWO_FACTOR_REQUIRED_ROLES', () => {
    const run = startWith({ NODE_ENV: 'production', TWO_FACTOR_REQUIRED_ROLES: 'NONE', ALLOW_ADMIN_WITHOUT_2FA: undefined });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('TWO_FACTOR_REQUIRED_ROLES: must include ADMIN in production');
  });

  test('starts: production with ADMIN (the default), quietly', () => {
    const run = startWith({ NODE_ENV: 'production', TWO_FACTOR_REQUIRED_ROLES: 'ADMIN,ORGANIZER', ALLOW_ADMIN_WITHOUT_2FA: undefined });
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('WARNING');
  });

  test('a local Docker stack may opt out, out loud', () => {
    const run = startWith({ NODE_ENV: 'production', TWO_FACTOR_REQUIRED_ROLES: 'NONE', ALLOW_ADMIN_WITHOUT_2FA: 'true' });
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('WARNING: admins can sign in WITHOUT two-factor');
  });

  test('development: any value', () => {
    expect(startWith({ NODE_ENV: 'development', TWO_FACTOR_REQUIRED_ROLES: 'NONE', ALLOW_ADMIN_WITHOUT_2FA: undefined }).status).toBe(0);
  });
});

/**
 * Create (or promote) the platform administrator.
 *
 *   npm run seed:admin
 *
 * Registration through the API always creates a CUSTOMER, so the first ADMIN
 * has to be created from the server side. The script is idempotent: running
 * it again only makes sure the account has the ADMIN role; it never changes
 * an existing password.
 *
 * Credentials: ADMIN_EMAIL / ADMIN_PASSWORD from the environment, falling
 * back to DEV_DEFAULT_ADMIN below. The default is for local development ONLY:
 * in production the script refuses to run without its own ADMIN_PASSWORD.
 */
const env = require('../config/env');
const { ROLES, USER_STATUS } = require('../config/constants');
const { withTransaction } = require('../database/transaction');
const { closePool } = require('../database/pool');
const logger = require('../utils/logger');
const users = require('../modules/users');
const { hashPassword } = require('../modules/auth/auth.service');
const { enableKnownTotpSecret } = require('../modules/auth');

const DEV_DEFAULT_ADMIN = Object.freeze({
  email: 'admin@etp.local',
  password: 'Admin@123456',
});

function resolveCredentials() {
  const email = (env.ADMIN_EMAIL ?? DEV_DEFAULT_ADMIN.email).trim().toLowerCase();
  const password = env.ADMIN_PASSWORD ?? DEV_DEFAULT_ADMIN.password;

  if (env.NODE_ENV === 'production' && password === DEV_DEFAULT_ADMIN.password) {
    throw new Error('Refusing to create an admin with the development default password in production. Set ADMIN_PASSWORD.');
  }
  // A two-factor secret known in advance is for test stacks (E2E) only: anyone
  // who reads it can compute the admin's codes. In production the admin sets
  // two-factor up at the first login.
  if (env.NODE_ENV === 'production' && env.ADMIN_TOTP_SECRET) {
    throw new Error('ADMIN_TOTP_SECRET is for test stacks only. Unset it: the admin sets up two-factor at the first login.');
  }
  return { email, password, totpSecret: env.ADMIN_TOTP_SECRET };
}

/**
 * @returns {Promise<{ userId: string, email: string, created: boolean }>}
 */
async function seedAdmin({ email, password, totpSecret } = resolveCredentials()) {
  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    let user = await users.findByEmail(client, email, { forUpdate: true });
    const created = !user;

    if (!user) {
      user = await users.insertUser(client, {
        email,
        passwordHash,
        firstName: 'System',
        lastName: 'Admin',
        status: USER_STATUS.ACTIVE,
        emailVerifiedAt: new Date(),
      });
    }
    await users.addRole(client, user.id, ROLES.ADMIN);
    if (totpSecret) await enableKnownTotpSecret(client, user.id, totpSecret);
    return { userId: user.id, email: user.email, created };
  });
}

if (require.main === module) {
  seedAdmin()
    .then(({ email, created }) => {
      logger.info({ email, created }, created ? 'Admin account created' : 'Admin account already exists; ADMIN role ensured');
    })
    .catch((err) => {
      logger.error({ err }, 'Failed to seed admin');
      process.exitCode = 1;
    })
    .finally(() => closePool());
}

module.exports = { seedAdmin, DEV_DEFAULT_ADMIN };

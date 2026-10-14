/**
 * Turn off two-factor authentication for one account, from the server:
 *
 *   npm run 2fa:reset -- admin@example.com
 *   (Docker: docker compose exec api npm run 2fa:reset -- admin@example.com)
 *
 * For when nobody else can do it from the admin pages: the last administrator
 * lost their phone and their recovery codes. The account is logged out
 * everywhere; an administrator sets two-factor up again at the next login.
 * Written to the audit log (as a system action) like the admin page action.
 */
const { withTransaction } = require('../database/transaction');
const { closePool, pool } = require('../database/pool');
const { closeRedis } = require('../redis/client');
const { closeQueues } = require('../queue/queues');
const logger = require('../utils/logger');
const users = require('../modules/users');
const auth = require('../modules/auth');
const { recordAudit } = require('../modules/audit');

const SYSTEM_CONTEXT = Object.freeze({ userId: null, ip: null, userAgent: 'script: npm run 2fa:reset' });

async function resetTwoFactorByEmail(email) {
  const user = await users.findByEmail(pool, email.trim().toLowerCase());
  if (!user) throw new Error(`No account with the email ${email}`);

  const wasOn = await withTransaction(async (client) => {
    const deleted = await auth.resetTwoFactor(client, user.id);
    await auth.revokeSessionsOfUser(client, user.id);
    if (deleted) {
      await recordAudit(client, {
        context: SYSTEM_CONTEXT,
        action: 'TWO_FACTOR_RESET',
        entityType: 'user',
        entityId: user.id,
        oldValue: { twoFactorEnabled: true },
        newValue: { twoFactorEnabled: false, reason: 'Reset from the server (npm run 2fa:reset)' },
      });
    }
    return deleted;
  });
  await auth.revokeAllTokensOfUser(user.id, { strict: true });
  if (wasOn) await auth.alertTwoFactorReset(user);
  return { email: user.email, wasOn };
}

if (require.main === module) {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run 2fa:reset -- <email>');
    process.exitCode = 1;
  } else {
    resetTwoFactorByEmail(email)
      .then(({ wasOn }) =>
        logger.info({ email }, wasOn ? 'Two-factor turned off; the account was logged out everywhere' : 'Two-factor was not on; sessions ended anyway'),
      )
      .catch((err) => {
        logger.error({ err }, 'Failed to reset two-factor');
        process.exitCode = 1;
      })
      .finally(async () => {
        await closeQueues();
        await closeRedis();
        await closePool();
      });
  }
}

module.exports = { resetTwoFactorByEmail };

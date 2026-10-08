/**
 * Check the SMTP configuration by sending one OTP-style email.
 *
 *   npm run mail:test -- you@example.com
 *
 * Uses exactly the same settings (backend/.env) and template as the API, so
 * if this email arrives, OTP emails will arrive too.
 */
const env = require('../config/env');
const { OTP, OTP_PURPOSE } = require('../config/constants');
const mailer = require('../mail/mailer');
const { otpEmail } = require('../mail/templates');

const SAMPLE_CODE = '123456';

/** Most common SMTP failures, translated into what to fix. */
function hintFor(err) {
  if (err.code === 'EAUTH') {
    return 'Login rejected. For Gmail, SMTP_PASS must be a 16-character App Password, not your normal password.';
  }
  if (err.code === 'ECONNECTION' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKET') {
    return 'Cannot reach the SMTP server. Check SMTP_HOST / SMTP_PORT, and SMTP_SECURE=true for port 465.';
  }
  if (err.code === 'EENVELOPE') {
    return 'Sender or recipient rejected. For Gmail, MAIL_FROM must use the same address as SMTP_USER.';
  }
  return 'See the error above.';
}

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: npm run mail:test -- you@example.com');
    process.exitCode = 1;
    return;
  }

  // Never print SMTP_PASS.
  console.log(
    `SMTP ${env.SMTP_HOST}:${env.SMTP_PORT} secure=${env.SMTP_SECURE} user=${env.SMTP_USER ?? '(none)'} from="${env.MAIL_FROM}"`,
  );

  try {
    await mailer.verifyConnection();
    console.log('✔ Connected and authenticated to the SMTP server');

    await mailer.sendMail({
      to,
      ...otpEmail({
        purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
        code: SAMPLE_CODE,
        firstName: 'Test',
        ttlMinutes: OTP.TTL_MINUTES,
      }),
    });
    console.log(`✔ Test email sent to ${to}. Check the inbox (and the Spam folder).`);
  } catch (err) {
    console.error(`✘ ${err.code ?? 'ERROR'}: ${err.message}`);
    console.error(`  Hint: ${hintFor(err)}`);
    process.exitCode = 1;
  }
}

main();

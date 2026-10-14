const { z } = require('zod');

const MAX_PASSWORD_LENGTH = 1024;
const MAX_MFA_TOKEN_LENGTH = 2000;

const mfaToken = z.string().min(20).max(MAX_MFA_TOKEN_LENGTH);
// "123 456" as some apps display it is fine.
const code = z
  .string()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'must be 6 digits'));
const recoveryCode = z.string().trim().min(8).max(20);
const password = z.string().min(1).max(MAX_PASSWORD_LENGTH);

/** Login step 2: a code from the app OR a recovery code. */
const verifyLogin = z
  .object({ mfaToken, code: code.optional(), recoveryCode: recoveryCode.optional() })
  .refine((body) => Boolean(body.code) !== Boolean(body.recoveryCode), { message: 'send either code or recoveryCode' });

const loginSetup = z.object({ mfaToken });
const confirmLoginSetup = z.object({ mfaToken, code });

const startSetup = z.object({ password });
const confirmSetup = z.object({ code });
const disable = z.object({ password, code });
const regenerateRecoveryCodes = z.object({ code });

module.exports = { verifyLogin, loginSetup, confirmLoginSetup, startSetup, confirmSetup, disable, regenerateRecoveryCodes };

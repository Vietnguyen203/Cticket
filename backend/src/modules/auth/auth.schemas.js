const { z } = require('zod');
const { personName, phoneNumber } = require('../../utils/schemas');
const { OTP, OTP_PURPOSE, PASSWORD } = require('../../config/constants');

const MAX_EMAIL_LENGTH = 255;
// Login accepts any stored password, but caps the input so nobody can make
// the server hash megabytes of data.
const MAX_LOGIN_PASSWORD_LENGTH = 1024;
const MIN_REFRESH_TOKEN_LENGTH = 20;
const MAX_REFRESH_TOKEN_LENGTH = 200;

const email = z.string().trim().toLowerCase().max(MAX_EMAIL_LENGTH).pipe(z.email());

/** Password policy for NEW passwords (register, reset). */
const newPassword = z
  .string()
  .min(PASSWORD.MIN_LENGTH, `must be at least ${PASSWORD.MIN_LENGTH} characters`)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD.MAX_BYTES, {
    message: `must be at most ${PASSWORD.MAX_BYTES} bytes`,
  })
  .refine((value) => /\p{L}/u.test(value) && /\d/.test(value), {
    message: 'must contain at least one letter and one digit',
  });

const name = personName;
const phone = phoneNumber;
const otp = z.string().regex(new RegExp(`^\\d{${OTP.LENGTH}}$`), `must be ${OTP.LENGTH} digits`);
const purpose = z.enum([OTP_PURPOSE.EMAIL_VERIFICATION, OTP_PURPOSE.PASSWORD_RESET]);
const refreshToken = z.string().min(MIN_REFRESH_TOKEN_LENGTH).max(MAX_REFRESH_TOKEN_LENGTH);

const register = z.object({
  email,
  password: newPassword,
  firstName: name,
  lastName: name,
  phone: phone.optional(),
});

const requestOtp = z.object({ email, purpose });

// The fields required depend on the purpose: a password reset also needs the new password.
const verifyOtp = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal(OTP_PURPOSE.EMAIL_VERIFICATION), email, otp }),
  z.object({ purpose: z.literal(OTP_PURPOSE.PASSWORD_RESET), email, otp, newPassword }),
]);

const login = z.object({
  email,
  password: z.string().min(1).max(MAX_LOGIN_PASSWORD_LENGTH),
  // Web app, cookie mode: a 7-day cookie instead of one that ends with the browser.
  remember: z.boolean().optional(),
});

// Optional here: the web app sends it in an httpOnly cookie instead (refresh-cookie.js).
const refresh = z.object({ refreshToken: refreshToken.optional() });
const logout = refresh;

module.exports = { register, requestOtp, verifyOtp, login, refresh, logout, refreshToken };

const { OTP_PURPOSE } = require('../config/constants');

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** User-provided text (e.g. a first name) must never be injected into HTML raw. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

const OTP_COPY = {
  [OTP_PURPOSE.EMAIL_VERIFICATION]: {
    subject: 'Mã xác thực tài khoản',
    intro: 'Cảm ơn bạn đã đăng ký. Mã xác thực email của bạn là:',
  },
  [OTP_PURPOSE.PASSWORD_RESET]: {
    subject: 'Mã đặt lại mật khẩu',
    intro: 'Bạn vừa yêu cầu đặt lại mật khẩu. Mã xác nhận của bạn là:',
  },
};

/**
 * @param {{ purpose: string, code: string, firstName?: string|null, ttlMinutes: number }} params
 * @returns {{ subject: string, text: string, html: string }}
 */
function otpEmail({ purpose, code, firstName, ttlMinutes }) {
  const copy = OTP_COPY[purpose];
  const greeting = firstName ? `Xin chào ${firstName},` : 'Xin chào,';
  const outro = `Mã có hiệu lực trong ${ttlMinutes} phút. Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.`;

  return {
    subject: copy.subject,
    text: `${greeting}\n\n${copy.intro}\n\n${code}\n\n${outro}`,
    html: `<p>${escapeHtml(greeting)}</p>
<p>${copy.intro}</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
<p>${outro}</p>`,
  };
}

module.exports = { otpEmail, escapeHtml };

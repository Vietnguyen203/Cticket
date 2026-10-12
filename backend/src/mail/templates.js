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

const formatVnd = (amount) => `${Number(amount).toLocaleString('vi-VN')}đ`;
const formatTime = (date) =>
  new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'full', timeStyle: 'short' });

/**
 * Sent once the tickets are issued (Q-02).
 * @param {{ order: object, tickets: Array<{ code: string, seatLabel: string|null, ticketTypeName: string }> }} params
 */
function orderConfirmedEmail({ order, tickets }) {
  const greeting = order.first_name ? `Xin chào ${order.first_name},` : 'Xin chào,';
  const when = `${formatTime(order.start_at)} tại ${order.venue_name}`;
  const lines = tickets.map((t) => `${t.code} — ${t.ticketTypeName}${t.seatLabel ? `, ghế ${t.seatLabel}` : ''}`);
  return {
    subject: `Xác nhận đơn ${order.order_code} — ${order.event_title}`,
    text: [
      greeting,
      '',
      `Đơn ${order.order_code} đã được thanh toán (${formatVnd(order.total_amount)}).`,
      `${order.event_title}, ${when}.`,
      '',
      `Vé của bạn (${tickets.length}):`,
      ...lines,
      '',
      'Mở mục Vé của tôi trong ứng dụng để xem mã QR khi vào cổng.',
    ].join('\n'),
    html: `<p>${escapeHtml(greeting)}</p>
<p>Đơn <b>${escapeHtml(order.order_code)}</b> đã được thanh toán (${formatVnd(order.total_amount)}).</p>
<p><b>${escapeHtml(order.event_title)}</b><br>${escapeHtml(when)}</p>
<p>Vé của bạn (${tickets.length}):</p>
<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
<p>Mở mục <b>Vé của tôi</b> trong ứng dụng để xem mã QR khi vào cổng.</p>`,
  };
}

/** Sent after a refund (Q-02). */
function orderRefundedEmail({ order }) {
  const greeting = order.first_name ? `Xin chào ${order.first_name},` : 'Xin chào,';
  const body = `Đơn ${order.order_code} (${order.event_title}) đã được hoàn ${formatVnd(order.total_amount)}. Các vé của đơn không còn hiệu lực.`;
  return {
    subject: `Đã hoàn tiền đơn ${order.order_code}`,
    text: `${greeting}\n\n${body}`,
    html: `<p>${escapeHtml(greeting)}</p>\n<p>${escapeHtml(body)}</p>`,
  };
}

module.exports = { otpEmail, orderConfirmedEmail, orderRefundedEmail, escapeHtml };

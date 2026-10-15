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
  // Phase 18.3: a customer's cancellation refunds part of it; the rest is the fee of the event's policy.
  const refunded = order.refunded_amount ?? order.total_amount;
  const fee = order.total_amount - refunded;
  const feeNote = fee > 0 ? ` Phí hủy theo chính sách của sự kiện: ${formatVnd(fee)}.` : '';
  const body = `Đơn ${order.order_code} (${order.event_title}) đã được hoàn ${formatVnd(refunded)}.${feeNote} Các vé của đơn không còn hiệu lực.`;
  return {
    subject: `Đã hoàn tiền đơn ${order.order_code}`,
    text: `${greeting}\n\n${body}`,
    html: `<p>${escapeHtml(greeting)}</p>\n<p>${escapeHtml(body)}</p>`,
  };
}

const TWO_FACTOR_COPY = {
  ENABLED: {
    subject: 'Đã bật xác thực hai lớp',
    body: () => 'Xác thực hai lớp vừa được bật cho tài khoản của bạn. Từ nay khi đăng nhập, bạn cần thêm mã từ ứng dụng xác thực trên điện thoại.',
  },
  DISABLED: {
    subject: 'Đã tắt xác thực hai lớp',
    body: () => 'Xác thực hai lớp vừa được tắt cho tài khoản của bạn. Đăng nhập giờ chỉ cần mật khẩu.',
  },
  RESET: {
    subject: 'Xác thực hai lớp đã được đặt lại',
    body: () =>
      'Quản trị viên vừa đặt lại xác thực hai lớp cho tài khoản của bạn và đăng xuất bạn khỏi mọi thiết bị. Nếu tài khoản của bạn bắt buộc dùng xác thực hai lớp, hãy thiết lập lại ở lần đăng nhập tới.',
  },
  RECOVERY_CODE_USED: {
    subject: 'Một mã khôi phục vừa được dùng',
    body: ({ codesLeft }) =>
      `Một mã khôi phục vừa được dùng để đăng nhập vào tài khoản của bạn. Còn ${codesLeft} mã chưa dùng; khi sắp hết, hãy tạo bộ mã mới trong trang tài khoản.`,
  },
};

/**
 * Phase 15: security notice after a two-factor change, so an account owner
 * notices a change they did not make.
 * @param {{ alert: keyof TWO_FACTOR_COPY, firstName?: string|null, codesLeft?: number }} params
 */
function twoFactorEmail({ alert, firstName, codesLeft }) {
  const copy = TWO_FACTOR_COPY[alert];
  const greeting = firstName ? `Xin chào ${firstName},` : 'Xin chào,';
  const body = copy.body({ codesLeft });
  const warning = 'Nếu không phải bạn, hãy đổi mật khẩu ngay và liên hệ quản trị viên.';
  return {
    subject: copy.subject,
    text: `${greeting}\n\n${body}\n\n${warning}`,
    html: `<p>${escapeHtml(greeting)}</p>\n<p>${escapeHtml(body)}</p>\n<p><strong>${warning}</strong></p>`,
  };
}

/**
 * Phase 17: VNPay took the money after the order stopped waiting for it
 * (expired, cancelled, or already paid by another attempt): it is refunded.
 */
function paymentReturnedEmail({ firstName, orderCode, amount }) {
  const greeting = firstName ? `Xin chào ${firstName},` : 'Xin chào,';
  const body = `Khoản thanh toán ${formatVnd(amount)} qua VNPay cho đơn ${orderCode} được ghi nhận khi đơn đã hết hạn, đã hủy hoặc đã được thanh toán bằng lượt khác. Chúng tôi đã gửi yêu cầu hoàn lại toàn bộ số tiền này qua VNPay; tiền về tài khoản của bạn theo thời gian xử lý của ngân hàng.`;
  return {
    subject: `Hoàn tiền thanh toán đơn ${orderCode}`,
    text: `${greeting}\n\n${body}`,
    html: `<p>${escapeHtml(greeting)}</p>\n<p>${escapeHtml(body)}</p>`,
  };
}

/** Phase 18.1: the first lock of a streak of wrong passwords / codes. */
function loginLockedEmail({ firstName, minutes }) {
  const greeting = firstName ? `Xin chào ${firstName},` : 'Xin chào,';
  const body = `Có người vừa nhập sai mật khẩu hoặc mã xác thực của tài khoản này nhiều lần liên tiếp, nên việc đăng nhập bằng email này tạm khóa ${minutes} phút. Bạn vẫn có thể đặt lại mật khẩu ngay để vào lại.`;
  const warning = 'Nếu không phải bạn, hãy đổi mật khẩu: có thể ai đó đang thử đoán mật khẩu của bạn.';
  return {
    subject: 'Đăng nhập tạm khóa sau nhiều lần sai mật khẩu',
    text: `${greeting}\n\n${body}\n\n${warning}`,
    html: `<p>${escapeHtml(greeting)}</p>\n<p>${escapeHtml(body)}</p>\n<p><strong>${warning}</strong></p>`,
  };
}

const REMINDER_WHEN = { '24H': 'ngày mai', '2H': 'khoảng 2 giờ nữa' };
const timeOfDay = (date) =>
  new Date(date).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });

/**
 * Phase 18.2: 24 hours / 2 hours before the show.
 * @param {{ order: object, tickets: Array<{ code: string, seatLabel: string|null, ticketTypeName: string }>,
 *   kind: '24H'|'2H', gatesOpenAt: Date }} params
 */
function eventReminderEmail({ order, tickets, kind, gatesOpenAt }) {
  const greeting = order.first_name ? `Xin chào ${order.first_name},` : 'Xin chào,';
  const when = `${formatTime(order.start_at)}`;
  const where = `${order.venue_name}, ${order.venue_address}, ${order.venue_city}`;
  const intro = `${order.event_title} sẽ diễn ra ${REMINDER_WHEN[kind]}: ${when}.`;
  const gates = `Cổng soát vé mở từ ${timeOfDay(gatesOpenAt)}. Mở mục Vé của tôi trong ứng dụng để lấy mã QR khi vào cổng.`;
  const lines = tickets.map((t) => `${t.code} — ${t.ticketTypeName}${t.seatLabel ? `, ghế ${t.seatLabel}` : ''}`);
  return {
    subject: `Nhắc lịch: ${order.event_title} — ${REMINDER_WHEN[kind]}`,
    text: [greeting, '', intro, `Địa điểm: ${where}.`, '', `Vé của bạn (${tickets.length}):`, ...lines, '', gates].join('\n'),
    html: `<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(intro)}</p>
<p>Địa điểm: ${escapeHtml(where)}</p>
<p>Vé của bạn (${tickets.length}):</p>
<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
<p>${escapeHtml(gates)}</p>
<p style="color:#64748b;font-size:12px">Không muốn nhận email nhắc lịch? Tắt trong trang Tài khoản.</p>`,
  };
}

/**
 * Phase 18.4: places freed up for someone on the waiting list; kept for them
 * until the offer ends.
 * @param {{ first_name: string|null, event_title: string, start_at: Date, venue_name: string,
 *   ticket_type_name: string, quantity: number, offer_expires_at: Date }} entry
 */
function waitlistOfferEmail(entry) {
  const greeting = entry.first_name ? `Xin chào ${entry.first_name},` : 'Xin chào,';
  const body = `Đã có ${entry.quantity} vé hạng ${entry.ticket_type_name} cho ${entry.event_title} (${formatTime(entry.start_at)}, ${entry.venue_name}).`;
  const deadline = `Số vé này được giữ riêng cho bạn tới ${timeOfDay(entry.offer_expires_at)}. Sau đó vé được mời cho người tiếp theo trong danh sách chờ.`;
  const action = 'Mở mục Danh sách chờ trong ứng dụng và bấm "Đặt ngay".';
  return {
    subject: `Đã có vé: ${entry.event_title}`,
    text: [greeting, '', body, deadline, '', action].join('\n'),
    html: `<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(body)}</p>
<p><strong>${escapeHtml(deadline)}</strong></p>
<p>${escapeHtml(action)}</p>`,
  };
}

/** Phase 19: a day after the show, to people who went in and have not reviewed it. */
function reviewInviteEmail({ first_name: firstName, event_title: eventTitle, start_at: startAt }) {
  const greeting = firstName ? `Xin chào ${firstName},` : 'Xin chào,';
  const body = `Cảm ơn bạn đã đến ${eventTitle} (${formatTime(startAt)}). Bạn thấy buổi diễn thế nào? Chấm sao và để lại vài dòng nhận xét giúp người mua sau và ban tổ chức.`;
  const action = 'Mở trang sự kiện trong ứng dụng, mục Đánh giá. Bạn có 60 ngày để viết hoặc sửa đánh giá.';
  return {
    subject: `Bạn thấy ${eventTitle} thế nào?`,
    text: [greeting, '', body, '', action].join('\n'),
    html: `<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(body)}</p>
<p>${escapeHtml(action)}</p>
<p style="color:#64748b;font-size:12px">Không muốn nhận email như thế này? Tắt "Nhắc lịch" trong trang Tài khoản.</p>`,
  };
}

module.exports = {
  reviewInviteEmail,
  waitlistOfferEmail,
  eventReminderEmail,
  otpEmail,
  orderConfirmedEmail,
  orderRefundedEmail,
  twoFactorEmail,
  paymentReturnedEmail,
  loginLockedEmail,
  escapeHtml,
};

import axios from 'axios'

export interface FieldIssue {
  field: string
  message: string
}

/** Every failed API call becomes one of these: the API's error envelope, or a network problem. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Validation problems by form field ("body.email" → "email"), in Vietnamese. */
  fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {}
    const errors: Record<string, string> = {}
    for (const issue of this.details as FieldIssue[]) {
      const field = issue.field.split('.').slice(1).join('.')
      errors[field] ??= translateIssue(issue.message)
    }
    return errors
  }
}

/** What the user reads for each error code of the API (backend/src/utils/errorCodes.js). */
const MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
  VALIDATION_ERROR: 'Thông tin chưa hợp lệ, vui lòng kiểm tra lại.',
  INVALID_OTP: 'Mã xác minh không đúng hoặc đã hết hạn.',
  UNAUTHENTICATED: 'Vui lòng đăng nhập.',
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  TOKEN_EXPIRED: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
  TOKEN_REVOKED: 'Phiên đăng nhập đã kết thúc, vui lòng đăng nhập lại.',
  INVALID_REFRESH_TOKEN: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
  REFRESH_TOKEN_REUSED: 'Phiên đăng nhập đã bị thu hồi để bảo vệ tài khoản. Vui lòng đăng nhập lại.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  EMAIL_NOT_VERIFIED: 'Email chưa được xác minh.',
  ACCOUNT_DISABLED: 'Tài khoản đã bị khóa.',
  NOT_FOUND: 'Không tìm thấy nội dung bạn cần.',
  EMAIL_TAKEN: 'Email này đã được đăng ký.',
  PHONE_TAKEN: 'Số điện thoại này đã được đăng ký.',
  INVENTORY_NOT_GENERATED: 'Suất diễn này chưa mở bán.',
  INSUFFICIENT_INVENTORY: 'Không còn đủ vé.',
  ACTIVE_ORDER_EXISTS: 'Bạn đang có một đơn chưa hoàn tất ở suất diễn này.',
  SEATS_UNAVAILABLE: 'Một số ghế vừa có người khác giữ.',
  ORDER_EXPIRED: 'Đơn hàng đã hết thời gian giữ chỗ.',
  ORDER_NOT_PAYABLE: 'Đơn hàng này không thể thanh toán ở trạng thái hiện tại.',
  ORDER_ALREADY_PAID: 'Đơn hàng đã được thanh toán.',
  SALES_NOT_OPEN: 'Chưa đến thời gian mở bán.',
  SALES_CLOSED: 'Đã hết thời gian bán vé.',
  TICKET_TYPE_UNAVAILABLE: 'Hạng vé này hiện không bán.',
  ORDER_LIMIT_EXCEEDED: 'Số vé vượt quá giới hạn cho một đơn.',
  IDEMPOTENCY_KEY_REUSED: 'Yêu cầu thanh toán không hợp lệ, vui lòng thử lại.',
  PROMOTION_INVALID: 'Mã giảm giá không dùng được cho đơn này.',
  TICKET_ALREADY_USED: 'Vé đã được sử dụng.',
  TICKET_NOT_VALID: 'Vé không còn hiệu lực.',
  QR_INVALID: 'Mã QR không phải vé hợp lệ.',
  WRONG_SCHEDULE: 'Vé thuộc suất diễn khác.',
  CHECKIN_NOT_OPEN: 'Chưa đến giờ check-in.',
  CHECKIN_CLOSED: 'Đã hết giờ check-in.',
  RESOURCE_LOCKED: 'Hệ thống đang bận, vui lòng thử lại.',
  CONCURRENCY_CONFLICT: 'Có thay đổi cùng lúc, vui lòng thử lại.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.',
  SERVICE_UNAVAILABLE: 'Dịch vụ tạm thời gián đoạn, vui lòng thử lại.',
  INTERNAL_ERROR: 'Có lỗi xảy ra, vui lòng thử lại.',
}

export function messageFor(code: string, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? MESSAGES.INTERNAL_ERROR
}

/** The API's validation messages are English rule descriptions; show the common ones in Vietnamese. */
function translateIssue(message: string): string {
  if (/email/i.test(message)) return 'Email không hợp lệ.'
  if (/at least one letter and one digit/.test(message)) return 'Cần có ít nhất một chữ cái và một chữ số.'
  const min = /at least (\d+) characters/.exec(message)
  if (min) return `Cần ít nhất ${min[1]} ký tự.`
  if (/8-15 digits/.test(message)) return 'Số điện thoại gồm 8–15 chữ số (có thể bắt đầu bằng +).'
  if (/digits/.test(message)) return 'Chỉ được nhập chữ số.'
  if (/required/i.test(message)) return 'Vui lòng nhập thông tin này.'
  return 'Giá trị không hợp lệ.'
}

/** Normalise anything thrown by axios into an ApiError. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { error?: { code?: string; message?: string; details?: unknown } } | undefined
    if (err.response && body?.error?.code) {
      const { code, message, details } = body.error
      return new ApiError(err.response.status, code, messageFor(code, message), details)
    }
    if (!err.response) return new ApiError(0, 'NETWORK_ERROR', messageFor('NETWORK_ERROR'))
    return new ApiError(err.response.status, 'INTERNAL_ERROR', messageFor('INTERNAL_ERROR'))
  }
  return new ApiError(0, 'INTERNAL_ERROR', messageFor('INTERNAL_ERROR'))
}

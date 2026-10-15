/**
 * Phase 17: why a VNPay payment did not go through, for the customer.
 * The codes are VNPay's vnp_ResponseCode (payment page) and, after the API
 * asked VNPay again, its vnp_TransactionStatus ("02": failed, no detail).
 */
const REASONS: Record<string, string> = {
  '02': 'Giao dịch không thành công.',
  '07': 'Giao dịch đang được ngân hàng kiểm tra thêm.',
  '09': 'Thẻ hoặc tài khoản chưa đăng ký Internet Banking.',
  '10': 'Thông tin thẻ hoặc tài khoản sai quá 3 lần.',
  '11': 'Đã quá thời gian thanh toán trên VNPay.',
  '12': 'Thẻ hoặc tài khoản đang bị khóa.',
  '13': 'Mã OTP không đúng.',
  '24': 'Bạn đã hủy giao dịch trên VNPay.',
  '51': 'Tài khoản không đủ số dư.',
  '65': 'Tài khoản đã vượt hạn mức giao dịch trong ngày.',
  '75': 'Ngân hàng đang bảo trì.',
  '79': 'Nhập sai mật khẩu thanh toán quá số lần cho phép.',
}

const FALLBACK = 'VNPay không thực hiện được giao dịch.'

/** A sentence for the customer; unknown codes get a general one (with the code, for support). */
export function vnpayReason(code: string | null | undefined): string {
  if (!code) return FALLBACK
  return REASONS[code] ?? `${FALLBACK} (mã ${code})`
}

/** VNPay stops taking money 2 minutes before the order's deadline; starting needs 3 (API: VNPAY.MIN_SECONDS_TO_PAY). */
export const VNPAY_MIN_SECONDS = 180

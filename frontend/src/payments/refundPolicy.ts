/**
 * Phase 18.3: the refund policies an organizer picks for an event (the same
 * tiers as backend/src/config/constants.js REFUND_POLICY_TIERS).
 */
export type RefundPolicy = 'NONE' | 'STANDARD' | 'FLEXIBLE'

export const REFUND_POLICIES: Array<{ value: RefundPolicy; label: string; summary: string }> = [
  { value: 'NONE', label: 'Không hoàn', summary: 'Khách không tự hủy đơn được.' },
  {
    value: 'STANDARD',
    label: 'Tiêu chuẩn',
    summary: 'Hủy trước giờ diễn từ 7 ngày: hoàn 80%; từ 3 ngày: hoàn 50%; sau đó không hủy được.',
  },
  {
    value: 'FLEXIBLE',
    label: 'Linh hoạt',
    summary: 'Hủy trước giờ diễn từ 48 giờ: hoàn 100%; từ 24 giờ: hoàn 50%; sau đó không hủy được.',
  },
]

export function refundPolicyOf(value: string | undefined | null) {
  return REFUND_POLICIES.find((p) => p.value === value) ?? REFUND_POLICIES[0]
}

/** Why an order cannot be cancelled by its buyer (API: details.reason). */
export const CANCEL_REFUSALS: Record<string, string> = {
  NO_REFUND_POLICY: 'Sự kiện này không cho khách tự hủy đơn.',
  TOO_LATE: 'Đã quá hạn hủy đơn theo chính sách của sự kiện.',
  CHECKED_IN: 'Đơn đã có vé vào cổng nên không hủy được.',
  SHOW_NOT_ON_SALE: 'Suất diễn không còn mở bán nên không hủy được.',
  NOT_PAID: 'Chỉ đơn đã thanh toán mới hủy được.',
}

const ORDER_STATUS: Record<string, [string, string]> = {
  PENDING: ['Mới tạo', 'bg-slate-100 text-slate-700'],
  HELD: ['Đang giữ chỗ', 'bg-amber-50 text-amber-800'],
  PAYMENT_PENDING: ['Chờ thanh toán', 'bg-amber-50 text-amber-800'],
  PAYMENT_FAILED: ['Thanh toán lỗi', 'bg-red-50 text-red-700'],
  PAID: ['Đã thanh toán', 'bg-emerald-50 text-emerald-700'],
  COMPLETED: ['Hoàn tất', 'bg-sky-50 text-sky-700'],
  EXPIRED: ['Hết hạn', 'bg-slate-100 text-slate-600'],
  CANCELLED: ['Đã hủy', 'bg-slate-100 text-slate-600'],
  REFUNDED: ['Đã hoàn tiền', 'bg-violet-50 text-violet-700'],
  // payments / tickets
  SUCCESS: ['Thành công', 'bg-emerald-50 text-emerald-700'],
  FAILED: ['Thất bại', 'bg-red-50 text-red-700'],
  VALID: ['Còn hiệu lực', 'bg-emerald-50 text-emerald-700'],
  USED: ['Đã vào cổng', 'bg-sky-50 text-sky-700'],
}

/** Statuses of orders, payments and tickets. */
export function OrderStatusBadge({ status }: { status: string }) {
  const [label, classes] = ORDER_STATUS[status] ?? [status, 'bg-slate-100 text-slate-700']
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${classes}`}>{label}</span>
}

import { Link, Navigate, useLocation } from 'react-router'
import { confirmVnpayReturn } from '../../api/orders'
import { AlertIcon, ClockIcon, XCircleIcon } from '../../components/icons'
import { Alert, Spinner } from '../../components/ui'
import { vnpayReason } from '../../payments/vnpayReasons'
import { useAsync } from '../../utils/useAsync'

/**
 * Phase 17: VNPay sends the customer back here (vnp_ReturnUrl) with the
 * result in the query string. The API checks it and asks VNPay itself; this
 * page only shows what the API says. Paid → straight to the order (tickets).
 */
export function VnpayReturnPage() {
  const { search } = useLocation()
  const result = useAsync(() => confirmVnpayReturn(search), `vnpay-return:${search}`)
  const r = result.data

  if (result.error) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-16">
        <Alert>{result.error.message}</Alert>
        <Link to="/orders" className="block text-center text-sm font-semibold text-brand-700 hover:underline">
          Xem đơn hàng của tôi
        </Link>
      </div>
    )
  }
  if (!r) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center text-brand-700" role="status">
        <Spinner />
        <p className="text-sm text-slate-600">Đang hỏi VNPay kết quả thanh toán…</p>
      </div>
    )
  }
  if (r.status === 'SUCCESS') return <Navigate to={`/orders/${r.orderId}`} replace />

  const look =
    r.status === 'FAILED'
      ? { icon: <XCircleIcon size={28} />, box: 'bg-red-50 text-red-600', title: 'Thanh toán chưa thành công' }
      : r.status === 'PENDING'
        ? { icon: <ClockIcon size={28} />, box: 'bg-sky-50 text-sky-600', title: 'Đang chờ VNPay xác nhận' }
        : { icon: <AlertIcon size={28} />, box: 'bg-amber-50 text-amber-600', title: 'Lượt thanh toán không còn dùng' }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="space-y-5 rounded-panel border border-line bg-white p-6 text-center shadow-card sm:p-8">
        <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${look.box}`}>{look.icon}</div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Kết quả thanh toán VNPay</p>
          <h1 className="mt-1 text-xl font-bold text-ink">{look.title}</h1>
        </div>
        <div className="text-left">
          {r.status === 'FAILED' && (
            <Alert>Thanh toán không thành công: {vnpayReason(r.responseCode)} Nếu đơn còn thời gian, bạn có thể thanh toán lại.</Alert>
          )}
          {r.status === 'PENDING' && (
            <Alert tone="info">
              VNPay chưa xác nhận giao dịch này. Nếu bạn đã trả tiền, đơn sẽ tự cập nhật trong vài phút; bạn không cần thanh toán lại.
            </Alert>
          )}
          {(r.status === 'REFUNDED' || r.status === 'CANCELLED') && (
            <Alert tone="warning">
              Lượt thanh toán này không còn được dùng cho đơn (đơn đã hết hạn, đã hủy hoặc đã được thanh toán bằng lượt khác). Nếu bạn đã bị trừ tiền, khoản
              đó được hoàn tự động qua VNPay.
            </Alert>
          )}
        </div>
        <Link to={`/orders/${r.orderId}`} className="flex h-11 items-center justify-center rounded-control bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">
          Về trang đơn hàng
        </Link>
      </div>
    </div>
  )
}

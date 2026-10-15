import { Link, Navigate, useLocation } from 'react-router'
import { confirmVnpayReturn } from '../../api/orders'
import { Alert, Card, FullPageSpinner } from '../../components/ui'
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
  if (!r) return <FullPageSpinner />
  if (r.status === 'SUCCESS') return <Navigate to={`/orders/${r.orderId}`} replace />

  const backToOrder = (
    <Link to={`/orders/${r.orderId}`} className="block text-center text-sm font-semibold text-brand-700 hover:underline">
      Về trang đơn hàng
    </Link>
  )
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="space-y-4">
        <h1 className="text-lg font-bold">Kết quả thanh toán VNPay</h1>
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
        {backToOrder}
      </Card>
    </div>
  )
}

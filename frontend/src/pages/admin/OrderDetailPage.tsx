import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { getOrderDetail, refundPayment, reissueTicketQr, retryRefund } from '../../api/admin'
import { toApiError } from '../../api/errors'
import { ConfirmDialog, PageHeader } from '../../admin/components'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { Alert, Button, Card, FullPageSpinner } from '../../components/ui'
import { refundPolicyOf } from '../../payments/refundPolicy'
import { vnpayReason } from '../../payments/vnpayReasons'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

type Action =
  | { kind: 'refund'; paymentId: string; provider: string }
  | { kind: 'retry-refund'; refundId: string }
  | { kind: 'reissue'; ticketId: string; code: string }

/** A payment's status: PENDING is a VNPay attempt waiting for VNPay (badge "Chờ thanh toán"). */
const paymentBadge = (status: string) => (status === 'PENDING' ? 'PAYMENT_PENDING' : status)

const REFUND_STATUS: Record<string, [string, string]> = {
  PENDING: ['Đang hoàn', 'text-amber-700'],
  SUCCESS: ['Đã hoàn', 'text-emerald-700'],
  FAILED: ['Hoàn lỗi', 'text-red-700'],
}

/** One order for an admin: lines, payments (refund), refunds (send again), tickets (new QR). */
export function OrderDetailPage() {
  const { id = '' } = useParams()
  const order = useAsync(() => getOrderDetail(id), `order:${id}`)
  const [action, setAction] = useState<Action | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (order.error) return <Alert>{order.error.message}</Alert>
  if (!order.data) return <FullPageSpinner />
  const o = order.data

  return (
    <>
      <PageHeader
        title={`Đơn ${o.orderCode}`}
        subtitle={
          <Link to="/admin/orders" className="text-brand-700 hover:underline">
            ← Danh sách đơn
          </Link>
        }
      />
      {done && (
        <div className="mb-4">
          <Alert tone="success">{done}</Alert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-2 text-sm lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-semibold">{o.event.title}</p>
            <OrderStatusBadge status={o.status} />
          </div>
          <p className="text-slate-600">
            {formatDateTime(o.schedule.startAt)} · {o.schedule.venueName}
          </p>
          <p className="text-slate-600">Người mua: {o.buyerEmail}</p>
          {o.termsAcceptedAt && (
            <p className="text-slate-600">
              Đồng ý Điều kiện giao dịch chung phiên bản {o.termsVersion} lúc {formatDateTime(o.termsAcceptedAt)}
              {o.refundPolicy && <> · chính sách hủy lúc mua: {refundPolicyOf(o.refundPolicy).label}</>}
            </p>
          )}
          <table className="mt-3 min-w-full">
            <tbody>
              {o.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="py-1.5">{item.seatLabel ?? `${item.ticketTypeName} × ${item.quantity}`}</td>
                  <td className="py-1.5 text-slate-500">{item.ticketTypeName}</td>
                  <td className="py-1.5 text-right">{formatVnd(item.totalAmount)}</td>
                </tr>
              ))}
              {o.discountAmount > 0 && (
                <tr className="border-t border-slate-100 text-emerald-700">
                  <td colSpan={2} className="py-1.5">
                    Giảm giá
                  </td>
                  <td className="py-1.5 text-right">−{formatVnd(o.discountAmount)}</td>
                </tr>
              )}
              <tr className="border-t border-slate-200 font-semibold">
                <td colSpan={2} className="py-2">
                  Tổng
                </td>
                <td className="py-2 text-right">{formatVnd(o.totalAmount)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card className="space-y-2 text-sm">
          <h2 className="font-semibold">Thanh toán</h2>
          {(o.payments ?? []).length === 0 && <p className="text-slate-500">Chưa có lần thanh toán nào.</p>}
          {o.payments?.map((payment) => (
            <div key={payment.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span>{formatVnd(payment.amount)}</span>
                <OrderStatusBadge status={paymentBadge(payment.status)} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {payment.provider} · {formatDateTime(payment.paidAt ?? payment.createdAt)}
                {payment.provider !== 'VNPAY' && payment.failureCode ? ` · ${payment.failureCode}` : ''}
              </p>
              {payment.provider === 'VNPAY' && (payment.providerTransactionId || payment.status === 'FAILED') && (
                <p className="mt-1 text-xs text-slate-500">
                  {payment.providerTransactionId && `Mã GD VNPay ${payment.providerTransactionId}`}
                  {payment.bankCode && ` · ${payment.bankCode}`}
                  {payment.status === 'FAILED' && ` · ${vnpayReason(payment.failureCode)}`}
                </p>
              )}
              {payment.status === 'SUCCESS' && o.status === 'PAID' && (
                <Button variant="danger" className="mt-2 w-full" onClick={() => setAction({ kind: 'refund', paymentId: payment.id, provider: payment.provider })}>
                  Hoàn tiền
                </Button>
              )}
            </div>
          ))}
          {(o.refunds ?? []).length > 0 && <h2 className="pt-2 font-semibold">Hoàn tiền</h2>}
          {o.refunds?.map((refund) => {
            const [label, color] = REFUND_STATUS[refund.status] ?? [refund.status, 'text-slate-600']
            return (
              <div key={refund.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span>{formatVnd(refund.amount)}</span>
                  <span className={`text-xs font-semibold ${color}`}>{label}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDateTime(refund.completedAt ?? refund.createdAt)}
                  {refund.attempts > 0 && ` · gửi VNPay ${refund.attempts} lần`}
                  {refund.providerRefundId && ` · mã GD ${refund.providerRefundId}`}
                </p>
                {refund.reason && <p className="mt-1 text-xs text-slate-500">Lý do: {refund.reason}</p>}
                {refund.failureMessage && <p className="mt-1 text-xs text-red-700">{refund.failureMessage}</p>}
                {refund.status === 'FAILED' && (
                  <Button variant="secondary" className="mt-2 w-full" onClick={() => setAction({ kind: 'retry-refund', refundId: refund.id })}>
                    Hoàn tiền lại
                  </Button>
                )}
              </div>
            )
          })}
        </Card>
      </div>

      <h2 className="mb-3 mt-6 text-lg font-semibold">Vé ({o.tickets?.length ?? 0})</h2>
      <Card className="!p-0">
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {o.tickets?.map((ticket) => (
              <tr key={ticket.id}>
                <td className="px-4 py-2.5 font-mono">{ticket.code}</td>
                <td className="px-4 py-2.5">{ticket.seatLabel ?? `${ticket.ticketTypeName} #${ticket.admissionNo}`}</td>
                <td className="px-4 py-2.5">
                  <OrderStatusBadge status={ticket.status} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  {ticket.status === 'VALID' && (
                    <Button variant="ghost" onClick={() => setAction({ kind: 'reissue', ticketId: ticket.id, code: ticket.code })}>
                      Cấp lại QR
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {(o.tickets ?? []).length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500">Chưa có vé (vé được phát hành sau khi thanh toán).</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {action?.kind === 'refund' && (
        <ConfirmDialog
          open
          title="Hoàn tiền toàn bộ đơn?"
          message={`Vé của đơn hết hiệu lực, ghế được mở bán lại, khách nhận email báo hoàn tiền. Đơn đã có vé vào cổng thì không hoàn được.${
            action.provider === 'VNPAY' ? ' Tiền được gửi trả qua VNPay ngay sau đó; theo dõi ở mục Hoàn tiền.' : ''
          }`}
          confirmLabel="Hoàn tiền"
          danger
          askReason
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            try {
              await refundPayment(action.paymentId, reason)
            } catch (err) {
              throw toApiError(err)
            }
            setDone(action.provider === 'VNPAY' ? 'Đã hoàn đơn; yêu cầu hoàn tiền đã gửi tới VNPay.' : 'Đã hoàn tiền.')
            order.reload()
          }}
        />
      )}
      {action?.kind === 'retry-refund' && (
        <ConfirmDialog
          open
          title="Gửi lại yêu cầu hoàn tiền tới VNPay?"
          message="Chỉ làm khi lý do lỗi đã được xử lý (VNPay hoạt động lại, hoặc đã liên hệ VNPay)."
          confirmLabel="Hoàn tiền lại"
          onClose={() => setAction(null)}
          onConfirm={async () => {
            try {
              await retryRefund(action.refundId)
            } catch (err) {
              throw toApiError(err)
            }
            setDone('Đã gửi lại yêu cầu hoàn tiền.')
            order.reload()
          }}
        />
      )}
      {action?.kind === 'reissue' && (
        <ConfirmDialog
          open
          title={`Cấp lại QR cho vé ${action.code}?`}
          message="Mã QR cũ (ảnh chụp, bản in) không vào cổng được nữa. Khách mở lại vé trong mục Vé của tôi để lấy mã mới."
          confirmLabel="Cấp lại QR"
          onClose={() => setAction(null)}
          onConfirm={async () => {
            try {
              await reissueTicketQr(action.ticketId)
            } catch (err) {
              throw toApiError(err)
            }
            setDone(`Đã cấp lại QR cho vé ${action.code}.`)
            order.reload()
          }}
        />
      )}
    </>
  )
}

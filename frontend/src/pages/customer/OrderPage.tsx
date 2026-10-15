import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, toApiError } from '../../api/errors'
import {
  cancelOrder,
  checkoutOrder,
  getOrder,
  getPaymentMethods,
  payOrder,
  previewPromotion,
  removeOrderSeat,
  startVnpayPayment,
  type PromotionPreview,
} from '../../api/orders'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { Alert, Button, Card, FullPageSpinner } from '../../components/ui'
import { VNPAY_MIN_SECONDS, vnpayReason } from '../../payments/vnpayReasons'
import { CancelOrderCard } from './CancelOrderCard'
import { realtime } from '../../realtime'
import { formatDateTime, formatVnd } from '../../utils/format'
import { mmss, useCountdown } from '../../utils/useCountdown'
import { useAsync } from '../../utils/useAsync'
import { uuid } from '../../utils/uuid'

const PROMO_REASONS: Record<string, string> = {
  NOT_FOUND: 'Mã không tồn tại.',
  INACTIVE: 'Mã đang tạm dừng.',
  NOT_STARTED: 'Mã chưa đến thời gian dùng.',
  EXPIRED: 'Mã đã hết hạn.',
  MIN_ORDER_AMOUNT: 'Đơn chưa đạt giá trị tối thiểu của mã.',
  USAGE_LIMIT: 'Mã đã hết lượt dùng.',
  PER_USER_LIMIT: 'Bạn đã dùng hết lượt của mã này.',
}

const messageOf = (err: ApiError) =>
  err.code === 'PROMOTION_INVALID' ? (PROMO_REASONS[(err.details as { reason?: string })?.reason ?? ''] ?? err.message) : err.message

/** Messages about this order pushed over the WebSocket (Phase 7–9, BKG-02): reload when one arrives. */
const ORDER_MESSAGES = [
  'ORDER_UPDATED',
  'ORDER_EXPIRED',
  'ORDER_CANCELLED',
  'ORDER_PAID',
  'ORDER_REFUNDED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'TICKET_ISSUED',
]

/** APP-C04: the held order → checkout (discount code) → pay (VNPay or the simulator) → tickets. */
export function OrderPage() {
  const { id = '' } = useParams()
  const order = useAsync(() => getOrder(id), `order:${id}`)
  const methods = useAsync(getPaymentMethods, 'payment-methods')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [checked, setChecked] = useState<PromotionPreview | null>(null)
  const o = order.data
  // A code checked against another subtotal (seats changed since: BKG-02) is not shown.
  const preview = checked && checked.subtotal === o?.subtotal ? checked : null
  const payable = o && ['HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(o.status)
  const ticketCount = o?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0
  const secondsLeft = useCountdown(payable ? o?.expiresAt : null)
  const { reload } = order
  // Phase 17: payments come newest first.
  const lastPayment = o?.payments?.[0]
  const vnpayPending = lastPayment?.provider === 'VNPAY' && lastPayment.status === 'PENDING'
  const offers = methods.data ?? []
  const tooLateForVnpay = secondsLeft !== null && secondsLeft < VNPAY_MIN_SECONDS

  useEffect(
    () =>
      realtime.onPersonalMessage((message) => {
        if (message.orderId === id && ORDER_MESSAGES.includes(message.type)) reload()
      }),
    [id, reload],
  )
  // Time is up on the server's clock: reload, the API expires the order and frees the seats.
  useEffect(() => {
    if (secondsLeft === 0) reload()
  }, [secondsLeft, reload])
  // Tickets are issued by the worker a moment after payment. VNPay's answer
  // arrives over the WebSocket; polling covers a missed message.
  const waitingTickets = o?.status === 'PAID' && (o.tickets ?? []).length === 0
  useEffect(() => {
    if (!waitingTickets && !vnpayPending) return undefined
    const timer = setInterval(reload, waitingTickets ? 2000 : 5000)
    return () => clearInterval(timer)
  }, [waitingTickets, vnpayPending, reload])

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    try {
      await action()
      reload()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(null)
    }
  }

  /** Phase 17: a new VNPay attempt, then off to VNPay's page (it sends the customer back to /payments/vnpay/return). */
  async function payWithVnpay() {
    setBusy('vnpay')
    setError(null)
    try {
      const { paymentUrl } = await startVnpayPayment(id)
      window.location.assign(paymentUrl)
    } catch (err) {
      setError(toApiError(err))
      setBusy(null)
    }
  }

  async function applyCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      setChecked(await previewPromotion(id, code.trim()))
    } catch (err) {
      setChecked(null)
      setError(toApiError(err))
    }
  }

  if (order.error) return <div className="mx-auto max-w-md px-4 py-16"><Alert>{order.error.message}</Alert></div>
  if (!o) return <FullPageSpinner />

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/orders" className="text-sm text-brand-700 hover:underline">
            ← Đơn hàng của tôi
          </Link>
          <h1 className="text-xl font-bold">Đơn {o.orderCode}</h1>
        </div>
        <OrderStatusBadge status={o.status} />
      </div>

      {payable && secondsLeft !== null && (
        <div className={`rounded-xl px-4 py-3 text-center ${secondsLeft < 120 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}`} role="timer">
          {o.status === 'HELD' ? 'Ghế được giữ cho bạn trong' : 'Thời gian còn lại để thanh toán'}{' '}
          <strong className="font-mono text-lg">{mmss(secondsLeft)}</strong>
        </div>
      )}
      {error && <Alert>{messageOf(error)}</Alert>}
      {o.status === 'PAYMENT_FAILED' && (
        <Alert>
          {lastPayment?.provider === 'VNPAY' ? `Thanh toán không thành công: ${vnpayReason(lastPayment.failureCode)}` : 'Thanh toán bị từ chối.'} Ghế vẫn
          được giữ, bạn có thể thanh toán lại.
        </Alert>
      )}
      {o.status === 'EXPIRED' && <Alert tone="warning">Đã hết thời gian giữ chỗ, ghế đã được mở bán lại.</Alert>}
      {o.status === 'PAID' && <Alert tone="success">Thanh toán thành công! {waitingTickets ? 'Vé đang được phát hành…' : 'Vé đã được gửi tới email của bạn.'}</Alert>}

      <Card className="space-y-2 text-sm">
        <p className="text-base font-semibold">{o.event.title}</p>
        <p className="text-slate-600">
          {formatDateTime(o.schedule.startAt)} · {o.schedule.venueName}
        </p>
        <table className="mt-2 min-w-full">
          <tbody>
            {o.items.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="py-1.5">{item.seatLabel ?? `${item.ticketTypeName} × ${item.quantity}`}</td>
                <td className="py-1.5 text-slate-500">{item.ticketTypeName}</td>
                <td className="py-1.5 text-right">
                  {formatVnd(item.totalAmount)}
                  {/* BKG-02: one seat out of the held order; the last ticket goes with "Hủy giữ chỗ". */}
                  {o.status === 'HELD' && item.seatId && ticketCount > 1 && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => run(`remove:${item.seatId}`, () => removeOrderSeat(id, item.seatId!))}
                      className="ml-3 text-xs font-semibold text-red-700 hover:underline disabled:text-slate-400"
                      aria-label={`Bỏ ghế ${item.seatLabel}`}
                    >
                      {busy === `remove:${item.seatId}` ? '…' : 'Bỏ'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {(o.discountAmount > 0 || preview) && (
              <tr className="border-t border-slate-100 text-emerald-700">
                <td colSpan={2} className="py-1.5">
                  Giảm giá{preview && o.status === 'HELD' ? ` (${preview.code})` : ''}
                </td>
                <td className="py-1.5 text-right">−{formatVnd(o.status === 'HELD' && preview ? preview.discountAmount : o.discountAmount)}</td>
              </tr>
            )}
            <tr className="border-t border-slate-200 text-base font-semibold">
              <td colSpan={2} className="py-2">
                Tổng cộng
              </td>
              <td className="py-2 text-right">{formatVnd(o.status === 'HELD' && preview ? preview.totalAmount : o.totalAmount)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {o.status === 'HELD' && (
        <Card className="space-y-3">
          <form onSubmit={applyCode} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase())
                setChecked(null)
              }}
              placeholder="Mã giảm giá (nếu có)"
              aria-label="Mã giảm giá"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 uppercase"
            />
            <Button type="submit" variant="secondary" disabled={code.trim().length < 3}>
              Áp dụng
            </Button>
          </form>
          {preview && <p className="text-sm text-emerald-700">Mã {preview.code}: giảm {formatVnd(preview.discountAmount)}.</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" loading={busy === 'checkout'} onClick={() => run('checkout', () => checkoutOrder(id, preview?.code))}>
              Tiếp tục thanh toán
            </Button>
            <Button variant="secondary" loading={busy === 'cancel'} onClick={() => run('cancel', () => cancelOrder(id))}>
              Hủy giữ chỗ
            </Button>
          </div>
          <Link
            to={`/events/${o.event.slug}/schedules/${o.schedule.id}`}
            className="block text-center text-sm font-semibold text-brand-700 hover:underline"
          >
            Đổi / thêm ghế
          </Link>
        </Card>
      )}

      {(o.status === 'PAYMENT_PENDING' || o.status === 'PAYMENT_FAILED') && (
        <Card className="space-y-3">
          {vnpayPending && (
            <Alert tone="info">
              Đang chờ VNPay xác nhận lượt thanh toán trước. Nếu bạn đã trả tiền, đơn sẽ tự cập nhật trong giây lát. Thanh toán lại sẽ thay lượt đó (nếu lượt cũ
              vẫn bị trừ tiền, khoản đó được hoàn tự động).
            </Alert>
          )}
          {offers.includes('VNPAY') &&
            (tooLateForVnpay ? (
              <p className="text-sm text-red-700">Còn dưới 3 phút: không đủ thời gian thanh toán qua VNPay. Hãy hủy đơn và đặt lại.</p>
            ) : (
              <Button className="w-full" loading={busy === 'vnpay'} disabled={busy !== null} onClick={payWithVnpay}>
                Thanh toán {formatVnd(o.totalAmount)} qua VNPay
              </Button>
            ))}
          {offers.includes('SIMULATOR') && (
            <>
              <p className="text-sm text-slate-600">
                Thanh toán <strong>giả lập</strong> (chỉ để thử, không có tiền thật). Bấm "Giả lập thẻ bị từ chối" để thử trường hợp lỗi.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {/* A new Idempotency-Key per click; retries of that click reuse it (api/orders.ts). */}
                <Button
                  className="flex-1"
                  variant={offers.includes('VNPAY') ? 'secondary' : 'primary'}
                  loading={busy === 'pay'}
                  disabled={busy !== null}
                  onClick={() => run('pay', () => payOrder(id, uuid()))}
                >
                  {offers.includes('VNPAY') ? 'Giả lập thanh toán thành công' : `Thanh toán ${formatVnd(o.totalAmount)}`}
                </Button>
                <Button variant="secondary" loading={busy === 'decline'} disabled={busy !== null} onClick={() => run('decline', () => payOrder(id, uuid(), 'FAILED'))}>
                  Giả lập thẻ bị từ chối
                </Button>
              </div>
            </>
          )}
          {methods.data && offers.length === 0 && <Alert>Hiện chưa nhận thanh toán trực tuyến. Vui lòng thử lại sau.</Alert>}
          {methods.error && <Alert>{methods.error.message}</Alert>}
          <Button variant="ghost" className="w-full" disabled={busy !== null} onClick={() => run('cancel', () => cancelOrder(id))}>
            Hủy đơn
          </Button>
        </Card>
      )}

      {/* Phase 18.3: cancel under the event's refund policy (keyed so a new status reloads the terms). */}
      {o.status === 'PAID' && <CancelOrderCard key={o.status} orderId={o.id} onCancelled={reload} />}

      {(o.refunds ?? []).length > 0 && (
        <Card className="space-y-2 text-sm">
          <h2 className="font-semibold">Hoàn tiền</h2>
          {o.refunds?.map((refund) => (
            <div key={refund.id} className="flex items-center justify-between gap-2">
              <span>
                {formatVnd(refund.amount)} · {formatDateTime(refund.createdAt)}
              </span>
              <span className={refund.status === 'SUCCESS' ? 'text-emerald-700' : 'text-amber-700'}>{refund.status === 'SUCCESS' ? 'Đã hoàn' : 'Đang xử lý'}</span>
            </div>
          ))}
          <p className="text-xs text-slate-500">Tiền hoàn qua VNPay về tài khoản của bạn theo thời gian xử lý của ngân hàng.</p>
        </Card>
      )}

      {(o.tickets ?? []).length > 0 && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Vé của đơn</h2>
          {o.tickets?.map((ticket) => (
            <Link key={ticket.id} to={`/tickets/${ticket.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-brand-600">
              <span>
                <span className="font-mono">{ticket.code}</span> · {ticket.seatLabel ?? `${ticket.ticketTypeName} #${ticket.admissionNo}`}
              </span>
              <span className="text-brand-700">Xem QR →</span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  )
}

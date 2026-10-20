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
import { downloadOrderTicketsPdf } from '../../api/tickets'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { Alert, Badge, Button, Card, FullPageSpinner } from '../../components/ui'
import { CalendarIcon, CheckCircleIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, MapPinIcon, ShieldIcon, TicketIcon } from '../../components/icons'
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

  const total = o.status === 'HELD' && preview ? preview.totalAmount : o.totalAmount
  const hasActions = o.status === 'HELD' || o.status === 'PAYMENT_PENDING' || o.status === 'PAYMENT_FAILED'

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
      <div className="space-y-2">
        <Link to="/orders" className="inline-flex items-center gap-1 rounded-control text-sm font-medium text-slate-600 hover:text-ink">
          <ChevronLeftIcon size={16} />
          Đơn hàng của tôi
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">Đơn {o.orderCode}</h1>
          <OrderStatusBadge status={o.status} />
        </div>
      </div>

      {/* What happened: from the API's order and payment status only, never from a click. */}
      {error && <Alert>{messageOf(error)}</Alert>}
      {o.status === 'PAYMENT_FAILED' && (
        <Alert>
          {lastPayment?.provider === 'VNPAY' ? `Thanh toán không thành công: ${vnpayReason(lastPayment.failureCode)}` : 'Thanh toán bị từ chối.'} Ghế vẫn
          được giữ, bạn có thể thanh toán lại.
        </Alert>
      )}
      {o.status === 'EXPIRED' && <Alert tone="warning">Đã hết thời gian giữ chỗ, ghế đã được mở bán lại.</Alert>}
      {o.status === 'PAID' && <Alert tone="success">Thanh toán thành công! {waitingTickets ? 'Vé đang được phát hành…' : 'Vé đã được gửi tới email của bạn.'}</Alert>}

      <div className={`grid gap-6 ${hasActions ? 'lg:grid-cols-[1fr_360px]' : ''}`}>
        {hasActions && (
          <aside className="space-y-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:self-start">
            {payable && secondsLeft !== null && (
              <div
                className={`flex items-center justify-between gap-3 rounded-card border px-4 py-3 transition-colors duration-300 ${
                  secondsLeft < 120 ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-950'
                }`}
                role="timer"
              >
                <span className="flex items-center gap-2 text-sm">
                  <ClockIcon size={18} />
                  {o.status === 'HELD' ? 'Ghế được giữ cho bạn trong' : 'Thời gian còn lại để thanh toán'}
                </span>
                {/* The last minute blinks softly: time is nearly up. */}
                <strong className={`font-mono text-xl tabular-nums ${secondsLeft < 60 ? 'animate-urgent' : ''}`}>{mmss(secondsLeft)}</strong>
              </div>
            )}

            {o.status === 'HELD' && (
              <Card className="space-y-4 !p-5">
                <form onSubmit={applyCode} className="space-y-2">
                  <label htmlFor="ma-giam-gia" className="block text-sm font-medium text-ink">
                    Mã giảm giá
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="ma-giam-gia"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value.toUpperCase())
                        setChecked(null)
                      }}
                      placeholder="Nhập mã (nếu có)"
                      aria-label="Mã giảm giá"
                      className="h-11 min-w-0 flex-1 rounded-control border border-line bg-white px-3 uppercase text-ink outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-brand-100"
                    />
                    <Button type="submit" variant="secondary" disabled={code.trim().length < 3}>
                      Áp dụng
                    </Button>
                  </div>
                  {preview && (
                    <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                      <CheckCircleIcon size={16} />
                      Mã {preview.code}: giảm {formatVnd(preview.discountAmount)}.
                    </p>
                  )}
                </form>
                <div className="flex items-baseline justify-between border-t border-line pt-4">
                  <span className="text-sm text-slate-600">Cần thanh toán</span>
                  <span className="text-xl font-bold text-ink">{formatVnd(total)}</span>
                </div>
                <div className="space-y-2">
                  <Button size="lg" className="w-full" loading={busy === 'checkout'} onClick={() => run('checkout', () => checkoutOrder(id, preview?.code))}>
                    Tiếp tục thanh toán
                  </Button>
                  <Button variant="secondary" className="w-full" loading={busy === 'cancel'} onClick={() => run('cancel', () => cancelOrder(id))}>
                    Hủy giữ chỗ
                  </Button>
                </div>
                <Link
                  to={`/events/${o.event.slug}/schedules/${o.schedule.id}`}
                  className="block rounded-control text-center text-sm font-semibold text-brand-700 hover:text-brand-800"
                >
                  Đổi / thêm ghế
                </Link>
              </Card>
            )}

            {(o.status === 'PAYMENT_PENDING' || o.status === 'PAYMENT_FAILED') && (
              <Card className="space-y-4 !p-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-slate-600">Cần thanh toán</span>
                  <span className="text-xl font-bold text-ink">{formatVnd(o.totalAmount)}</span>
                </div>
                {vnpayPending && (
                  <Alert tone="info">
                    Đang chờ VNPay xác nhận lượt thanh toán trước. Nếu bạn đã trả tiền, đơn sẽ tự cập nhật trong giây lát. Thanh toán lại sẽ thay lượt đó (nếu lượt
                    cũ vẫn bị trừ tiền, khoản đó được hoàn tự động).
                  </Alert>
                )}
                {offers.includes('VNPAY') &&
                  (tooLateForVnpay ? (
                    <p className="text-sm text-red-700">Còn dưới 3 phút: không đủ thời gian thanh toán qua VNPay. Hãy hủy đơn và đặt lại.</p>
                  ) : (
                    <Button size="lg" className="w-full" loading={busy === 'vnpay'} disabled={busy !== null} onClick={payWithVnpay}>
                      Thanh toán {formatVnd(o.totalAmount)} qua VNPay
                    </Button>
                  ))}
                {offers.includes('SIMULATOR') && (
                  <div className="space-y-2 rounded-control border border-dashed border-line p-3">
                    <p className="text-sm text-slate-600">
                      Thanh toán <strong>giả lập</strong> (chỉ để thử, không có tiền thật). Bấm "Giả lập thẻ bị từ chối" để thử trường hợp lỗi.
                    </p>
                    {/* A new Idempotency-Key per click; retries of that click reuse it (api/orders.ts). */}
                    <Button
                      className="w-full"
                      variant={offers.includes('VNPAY') ? 'secondary' : 'primary'}
                      loading={busy === 'pay'}
                      disabled={busy !== null}
                      onClick={() => run('pay', () => payOrder(id, uuid()))}
                    >
                      {offers.includes('VNPAY') ? 'Giả lập thanh toán thành công' : `Thanh toán ${formatVnd(o.totalAmount)}`}
                    </Button>
                    <Button variant="secondary" className="w-full" loading={busy === 'decline'} disabled={busy !== null} onClick={() => run('decline', () => payOrder(id, uuid(), 'FAILED'))}>
                      Giả lập thẻ bị từ chối
                    </Button>
                  </div>
                )}
                {methods.data && offers.length === 0 && <Alert>Hiện chưa nhận thanh toán trực tuyến. Vui lòng thử lại sau.</Alert>}
                {methods.error && <Alert>{methods.error.message}</Alert>}
                <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
                  <ShieldIcon size={16} className="mt-px shrink-0 text-brand-700" />
                  Đơn chỉ thành công khi cổng thanh toán xác nhận. Không đóng trang trong lúc thanh toán.
                </p>
                <Button variant="ghost" className="w-full" disabled={busy !== null} onClick={() => run('cancel', () => cancelOrder(id))}>
                  Hủy đơn
                </Button>
              </Card>
            )}
          </aside>
        )}

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <Card className="!p-0">
            <div className="space-y-2 border-b border-line p-5">
              <p className="text-lg font-semibold text-ink">{o.event.title}</p>
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                <span className="flex items-center gap-1.5">
                  <CalendarIcon size={16} className="text-slate-400" />
                  {formatDateTime(o.schedule.startAt)}
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPinIcon size={16} className="text-slate-400" />
                  {o.schedule.venueName}
                </span>
              </p>
            </div>
            <table className="min-w-full text-sm">
              <caption className="sr-only">Vé trong đơn</caption>
              <tbody>
                {o.items.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 font-medium text-ink">{item.seatLabel ?? `${item.ticketTypeName} × ${item.quantity}`}</td>
                    <td className="py-3 text-slate-500">{item.ticketTypeName}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      {formatVnd(item.totalAmount)}
                      {/* BKG-02: one seat out of the held order; the last ticket goes with "Hủy giữ chỗ". */}
                      {o.status === 'HELD' && item.seatId && ticketCount > 1 && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => run(`remove:${item.seatId}`, () => removeOrderSeat(id, item.seatId!))}
                          className="ml-3 rounded-control px-1.5 py-0.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:text-slate-400"
                          aria-label={`Bỏ ghế ${item.seatLabel}`}
                        >
                          {busy === `remove:${item.seatId}` ? '…' : 'Bỏ'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {(o.discountAmount > 0 || preview) && (
                  <tr className="border-t border-line text-emerald-700">
                    <td colSpan={2} className="px-5 py-3">
                      Giảm giá{preview && o.status === 'HELD' ? ` (${preview.code})` : ''}
                    </td>
                    <td className="px-5 py-3 text-right">−{formatVnd(o.status === 'HELD' && preview ? preview.discountAmount : o.discountAmount)}</td>
                  </tr>
                )}
                <tr className="border-t border-line bg-canvas text-base font-semibold text-ink">
                  <td colSpan={2} className="px-5 py-3.5">
                    Tổng cộng
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-right">{formatVnd(total)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          {/* Phase 18.3: cancel under the event's refund policy (keyed so a new status reloads the terms). */}
          {o.status === 'PAID' && <CancelOrderCard key={o.status} orderId={o.id} onCancelled={reload} />}

          {(o.tickets ?? []).length > 0 && (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">Vé của đơn</h2>
                {/* Phase 20: every valid ticket of the order, one page each. */}
                {o.tickets?.some((ticket) => ticket.status === 'VALID') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === 'pdf'}
                    disabled={busy !== null}
                    onClick={() => void run('pdf', () => downloadOrderTicketsPdf(o.id, o.orderCode))}
                  >
                    Tải vé PDF
                  </Button>
                )}
              </div>
              {o.tickets?.map((ticket) => (
                <Link
                  key={ticket.id}
                  to={`/tickets/${ticket.id}`}
                  className="group flex items-center justify-between gap-3 rounded-control border border-line px-4 py-3 text-sm transition hover:border-brand-600 hover:bg-brand-50/40"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <TicketIcon size={20} className="shrink-0 text-brand-700" />
                    <span className="min-w-0">
                      <span className="block font-mono font-medium text-ink">{ticket.code}</span>
                      <span className="block truncate text-slate-500">{ticket.seatLabel ?? `${ticket.ticketTypeName} #${ticket.admissionNo}`}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-semibold text-brand-700">
                    Xem QR <ChevronRightIcon size={16} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </Card>
          )}

          {(o.refunds ?? []).length > 0 && (
            <Card className="space-y-3 text-sm">
              <h2 className="text-lg font-semibold text-ink">Hoàn tiền</h2>
              {o.refunds?.map((refund) => (
                <div key={refund.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold text-ink">{formatVnd(refund.amount)}</span> · {formatDateTime(refund.createdAt)}
                  </span>
                  <Badge tone={refund.status === 'SUCCESS' ? 'success' : 'warning'}>{refund.status === 'SUCCESS' ? 'Đã hoàn' : 'Đang xử lý'}</Badge>
                </div>
              ))}
              <p className="text-xs text-slate-500">Tiền hoàn qua VNPay về tài khoản của bạn theo thời gian xử lý của ngân hàng.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

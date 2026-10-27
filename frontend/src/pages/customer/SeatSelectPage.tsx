import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, toApiError } from '../../api/errors'
import { CheckoutSteps } from '../../components/CheckoutSteps'
import { getEvent } from '../../api/events'
import { createOrder, listMyOrders, updateOrderItems } from '../../api/orders'
import type { Order, Seat, SeatMap, TicketTypeAvailability } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { WaitlistOffer } from './WaitlistOffer'
import { WaitingRoom } from './WaitingRoom'
import { usePurchaseQueue } from '../../queue/usePurchaseQueue'
import { mustWait } from '../../queue/waitingRoom'
import { Alert, Button, Card, FullPageSpinner } from '../../components/ui'
import { CalendarIcon, ChevronLeftIcon, MapPinIcon } from '../../components/icons'
import { realtime } from '../../realtime'
import {
  editChanges,
  gaLeftFor,
  isMine,
  selectionSummary,
  MAX_TICKETS_PER_ORDER,
  type EditedOrder,
  type SeatMapAction,
  type SeatMapState,
} from '../../realtime/seatMapReducer'
import { useRealtimeState, useScheduleSeats } from '../../realtime/useScheduleSeats'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'
import { mmss, useCountdown } from '../../utils/useCountdown'

/** One colour per ticket type (in the order the API lists them). */
const TYPE_COLORS = ['bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500']

const OPEN_STATUSES = ['HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED']

/** My unfinished order for this schedule, if any (at most one: uq_orders_active_cart). */
async function findMyOpenOrder(scheduleId: string): Promise<Order | null> {
  const { orders } = await listMyOrders({ scheduleId, pageSize: 10 })
  return orders.find((order) => OPEN_STATUSES.includes(order.status)) ?? null
}

const toEdited = (order: Order): EditedOrder => ({
  id: order.id,
  orderCode: order.orderCode,
  expiresAt: order.expiresAt ?? '',
  seatIds: order.items.flatMap((item) => (item.seatId ? [item.seatId] : [])),
  gaQuantities: Object.fromEntries(order.items.filter((item) => !item.seatId).map((item) => [item.ticketTypeId, item.quantity])),
})

/**
 * APP-C03: pick seats on the live map (and standing tickets), then hold them for 10 minutes.
 * BKG-02: with a held order for this schedule, the same page changes that order instead.
 */
export function SeatSelectPage() {
  const { slug = '', scheduleId = '' } = useParams()
  const event = useAsync(() => getEvent(slug), `event:${slug}`)
  const { state, dispatch, error, reload } = useScheduleSeats(scheduleId)
  const connection = useRealtimeState()
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [holdError, setHoldError] = useState<ApiError | null>(null)

  const myOrder = useAsync(
    () => (status === 'authenticated' ? findMyOpenOrder(scheduleId) : Promise.resolve(null)),
    `my-open-order:${scheduleId}:${status}`,
  )
  const heldOrder = myOrder.data?.status === 'HELD' ? myOrder.data : null
  const awaitingPayment = myOrder.data && myOrder.data.status !== 'HELD' ? myOrder.data : null
  const { reload: reloadMyOrder } = myOrder
  const myOrderId = myOrder.data?.id

  // The picks start as what the held order holds; they follow it when it changes (another tab, expiry).
  useEffect(() => {
    dispatch({ type: 'editOrder', order: heldOrder ? toEdited(heldOrder) : null })
  }, [heldOrder, dispatch])
  useEffect(() => {
    if (!myOrderId) return undefined
    return realtime.onPersonalMessage((message) => {
      if (message.orderId === myOrderId) reloadMyOrder()
    })
  }, [myOrderId, reloadMyOrder])
  const secondsLeft = useCountdown(state.editing?.expiresAt)
  useEffect(() => {
    if (secondsLeft === 0) reloadMyOrder() // the API expires it and frees the seats
  }, [secondsLeft, reloadMyOrder])

  const schedule = event.data?.schedules.find((s) => s.id === scheduleId)
  const summary = selectionSummary(state)
  const changes = editChanges(state)

  // Phase 21: the event's purchase queue (signed-in buyers; someone with an open order is never held back).
  const queueOn = event.data?.queue?.enabled === true && status === 'authenticated'
  const queue = usePurchaseQueue(event.data?.id, queueOn)
  const turnSecondsLeft = useCountdown(queue.view?.enabled && queue.view.state === 'ACTIVE' ? queue.view.turnEndsAt : null)

  async function submit() {
    if (status !== 'authenticated') {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`)
      return
    }
    setHoldError(null)
    dispatch({ type: 'holdStarted' })
    try {
      const items = Object.entries(state.gaQuantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }))
      const content = {
        ...(state.selected.length > 0 ? { seatIds: state.selected } : {}),
        ...(items.length > 0 ? { items } : {}),
      }
      const order = state.editing ? await updateOrderItems(state.editing.id, content) : await createOrder(scheduleId, content)
      navigate(`/orders/${order.id}`)
    } catch (err) {
      const apiError = toApiError(err)
      dispatch({ type: 'holdFailed' })
      setHoldError(apiError)
      if (['SEATS_UNAVAILABLE', 'INSUFFICIENT_INVENTORY'].includes(apiError.code)) void reload()
      if (['ACTIVE_ORDER_EXISTS', 'ORDER_EXPIRED', 'INVALID_STATE_TRANSITION'].includes(apiError.code)) reloadMyOrder()
      if (apiError.code === 'QUEUE_TURN_REQUIRED') queue.refresh() // back to my place in line
    }
  }

  if (queue.view && mustWait(queue.view, myOrder.data != null)) {
    return (
      <WaitingRoom
        eventTitle={event.data?.title ?? 'Sự kiện'}
        view={queue.view}
        firstPlace={queue.firstPlace}
        onLeave={() => void queue.leave().finally(() => navigate(`/events/${slug}`))}
      />
    )
  }
  if (error && !state.map) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <Alert>{error.code === 'NOT_FOUND' ? 'Suất diễn này chưa mở bán.' : error.message}</Alert>
        <Link to={`/events/${slug}`} className="mt-4 inline-block font-semibold text-brand-700 hover:underline">
          Quay lại sự kiện
        </Link>
      </div>
    )
  }
  if (!state.map) return <FullPageSpinner />
  const map = state.map
  const editing = state.editing

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {!editing && (
        <div className="mb-5 max-w-md">
          <CheckoutSteps current={0} />
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/events/${slug}`} className="inline-flex max-w-full items-center gap-1 rounded-control text-sm font-medium text-slate-600 hover:text-ink">
            <ChevronLeftIcon size={16} className="shrink-0" />
            <span className="truncate">{event.data?.title ?? 'Sự kiện'}</span>
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">{editing ? 'Đổi ghế' : 'Chọn chỗ'}</h1>
          {schedule && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
              <span className="flex items-center gap-1.5">
                <CalendarIcon size={16} className="text-slate-400" />
                {formatDateTime(schedule.startAt)}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPinIcon size={16} className="text-slate-400" />
                {schedule.venue.name}
              </span>
            </p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            connection === 'open' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
          }`}
          title="Ghế đổi màu ngay khi người khác giữ / mua"
        >
          <span className="relative flex h-2 w-2">
            {connection === 'open' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${connection === 'open' ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
          </span>
          {connection === 'open' ? 'Cập nhật trực tiếp' : 'Đang kết nối lại…'}
        </span>
      </div>

      <div className="mb-4 space-y-2">
        {editing && (
          <Alert tone="info">
            Bạn đang giữ đơn <strong>{editing.orderCode}</strong>
            {secondsLeft !== null && (
              <>
                {' '}
                · còn <strong className="font-mono">{mmss(secondsLeft)}</strong>
              </>
            )}
            . Chạm để bỏ hoặc thêm ghế, rồi bấm "Cập nhật đơn".{' '}
            <Link to={`/orders/${editing.id}`} className="font-semibold underline">
              Mở đơn
            </Link>
          </Alert>
        )}
        {awaitingPayment && (
          <Alert tone="warning">
            Bạn có đơn <strong>{awaitingPayment.orderCode}</strong> đang chờ thanh toán ở suất này.{' '}
            <Link to={`/orders/${awaitingPayment.id}`} className="font-semibold underline">
              Mở đơn
            </Link>
          </Alert>
        )}
        {!editing && !awaitingPayment && turnSecondsLeft !== null && (
          <Alert tone="success">
            Đến lượt bạn mua vé. Lượt của bạn còn <strong className="font-mono">{mmss(turnSecondsLeft)}</strong>: chọn chỗ và
            bấm "Giữ chỗ" trước khi hết giờ.
          </Alert>
        )}
        <Notices state={state} map={map} dispatch={dispatch} holdError={holdError} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* min-w-0: a long row of seats scrolls inside its card instead of widening the page. */}
        <div className="min-w-0 space-y-4">
          <Legend ticketTypes={map.ticketTypes} editing={editing !== null} />
          {map.zones.map((zone) =>
            zone.kind === 'SEATED' ? (
              <Card key={zone.id} className="!p-4 sm:!p-5">
                <p className="mb-4 font-semibold text-ink">{zone.name}</p>
                <div className="mx-auto mb-5 max-w-md rounded-b-[2rem] bg-night py-2 text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-white/80">
                  Sân khấu
                </div>
                <SeatRows seats={zone.seats} state={state} ticketTypes={map.ticketTypes} dispatch={dispatch} />
              </Card>
            ) : (
              <StandingZone key={zone.id} name={zone.name} ticketTypes={map.ticketTypes.filter((tt) => tt.venueZoneId === zone.id && tt.inventoryMode === 'GENERAL_ADMISSION')} state={state} dispatch={dispatch} />
            ),
          )}
          {/* Standing tickets not tied to a zone */}
          <StandingZone
            name="Vé đứng"
            ticketTypes={map.ticketTypes.filter((tt) => tt.inventoryMode === 'GENERAL_ADMISSION' && !map.zones.some((z) => z.id === tt.venueZoneId))}
            state={state}
            dispatch={dispatch}
          />
          {/* Phase 18.4 */}
          {!editing && <WaitlistOffer scheduleId={scheduleId} ticketTypes={map.ticketTypes} />}
        </div>

        {/* Phones: the summary and its button stay at the bottom of the screen while choosing. */}
        <aside className="sticky bottom-0 z-10 -mx-4 sm:-mx-6 lg:top-24 lg:bottom-auto lg:mx-0 lg:self-start">
          <Card className="space-y-3 !rounded-b-none !p-4 !pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-raised lg:!rounded-card lg:!pb-4 lg:shadow-card">
            <h2 className="font-semibold text-ink">{editing ? `Đơn ${editing.orderCode} sau khi đổi` : 'Bạn đã chọn'}</h2>
            {summary.lines.length === 0 ? (
              <p className="hidden text-sm text-slate-500 lg:block">
                {editing ? 'Muốn bỏ hết thì bấm "Hủy giữ chỗ" ở trang đơn.' : 'Chạm vào ghế trống trên sơ đồ, hoặc chọn số vé đứng.'}
              </p>
            ) : (
              <ul className="hidden max-h-60 space-y-1 overflow-y-auto text-sm lg:block">
                {summary.lines.map((line) => (
                  <li key={line.label} className="flex justify-between gap-2">
                    <span>
                      {line.label}
                      {line.quantity > 1 && ` × ${line.quantity}`}
                    </span>
                    <span className="whitespace-nowrap">{formatVnd(line.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {editing && !changes.none && <ChangeList changes={changes} map={map} />}
            <div className="flex justify-between border-t border-line pt-3 font-semibold text-ink">
              <span>Tạm tính ({summary.count}/{MAX_TICKETS_PER_ORDER} vé)</span>
              <span>{formatVnd(summary.total)}</span>
            </div>
            <Button
              className="w-full"
              loading={state.holding}
              disabled={summary.count === 0 || (editing !== null && changes.none) || awaitingPayment !== null}
              onClick={submit}
            >
              {editing ? 'Cập nhật đơn' : status === 'authenticated' ? 'Giữ chỗ (10 phút)' : 'Đăng nhập để giữ chỗ'}
            </Button>
            <p className="hidden text-xs leading-relaxed text-slate-500 lg:block">
              {editing
                ? 'Ghế bạn bỏ ra được mở bán lại ngay. Thời gian giữ chỗ không đổi.'
                : 'Giá cuối cùng do hệ thống tính lúc giữ chỗ. Ghế được giữ 10 phút để bạn thanh toán.'}
            </p>
          </Card>
        </aside>
      </div>
    </div>
  )
}

/** "Thêm: A07 · Bỏ: A05 · Vé đứng: 2 → 3" */
function ChangeList({ changes, map }: { changes: ReturnType<typeof editChanges>; map: SeatMap }) {
  const codeOf = (seatId: string) => map.zones.flatMap((z) => z.seats).find((s) => s.seatId === seatId)?.code ?? '?'
  const nameOf = (ticketTypeId: string) => map.ticketTypes.find((tt) => tt.id === ticketTypeId)?.name ?? 'Vé đứng'
  return (
    <ul className="space-y-0.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700" aria-label="Thay đổi">
      {changes.added.length > 0 && (
        <li>
          <span className="font-semibold text-emerald-700">Thêm:</span> {changes.added.map(codeOf).join(', ')}
        </li>
      )}
      {changes.removed.length > 0 && (
        <li>
          <span className="font-semibold text-red-700">Bỏ:</span> {changes.removed.map(codeOf).join(', ')}
        </li>
      )}
      {changes.ga.map((change) => (
        <li key={change.ticketTypeId}>
          <span className="font-semibold">{nameOf(change.ticketTypeId)}:</span> {change.from} → {change.to}
        </li>
      ))}
    </ul>
  )
}

function Notices({ state, map, dispatch, holdError }: { state: SeatMapState; map: SeatMap; dispatch: (a: SeatMapAction) => void; holdError: ApiError | null }) {
  const codeOf = (seatId: string) => map.zones.flatMap((z) => z.seats).find((s) => s.seatId === seatId)?.code ?? '?'
  const activeOrder = holdError?.code === 'ACTIVE_ORDER_EXISTS' ? (holdError.details as { orderId?: string } | undefined)?.orderId : undefined
  const takenSeats = holdError?.code === 'SEATS_UNAVAILABLE' && Array.isArray(holdError.details)
    ? (holdError.details as Array<{ seatId: string }>).map((d) => codeOf(d.seatId))
    : []
  return (
    <>
      {state.taken.length > 0 && (
        <Alert tone="warning">
          Ghế {state.taken.map(codeOf).join(', ')} vừa có người khác giữ, đã bỏ khỏi lựa chọn của bạn.{' '}
          <button type="button" onClick={() => dispatch({ type: 'dismissNotices' })} className="font-semibold underline">
            Đóng
          </button>
        </Alert>
      )}
      {state.notice && <Alert tone="info">{state.notice}</Alert>}
      {holdError && (
        <Alert>
          {holdError.message}
          {takenSeats.length > 0 && ` (${takenSeats.join(', ')})`}
          {activeOrder && (
            <>
              {' '}
              <Link to={`/orders/${activeOrder}`} className="font-semibold underline">
                Mở đơn đang giữ
              </Link>
            </>
          )}
        </Alert>
      )}
    </>
  )
}

function Legend({ ticketTypes, editing }: { ticketTypes: TicketTypeAvailability[]; editing: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">
      {ticketTypes
        .filter((tt) => tt.inventoryMode === 'RESERVED')
        .map((tt, index) => (
          <span key={tt.id} className="flex items-center gap-1.5">
            <span className={`h-4 w-4 rounded ${TYPE_COLORS[index % TYPE_COLORS.length]}`} /> {tt.name} · {formatVnd(tt.price)}
          </span>
        ))}
      <span className="flex items-center gap-1.5">
        <span className="h-4 w-4 rounded bg-brand-800 ring-2 ring-brand-300" /> Bạn chọn
      </span>
      {editing && (
        <span className="flex items-center gap-1.5">
          <span className="h-4 w-4 rounded bg-slate-400 opacity-60 outline-2 outline-dashed outline-red-500" /> Ghế bạn bỏ ra
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="h-4 w-4 rounded bg-amber-200" /> Đang có người giữ
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-4 w-4 rounded bg-slate-300" /> Đã bán / không bán
      </span>
    </div>
  )
}

function SeatRows({ seats, state, ticketTypes, dispatch }: { seats: Seat[]; state: SeatMapState; ticketTypes: TicketTypeAvailability[]; dispatch: (a: SeatMapAction) => void }) {
  const reserved = ticketTypes.filter((tt) => tt.inventoryMode === 'RESERVED')
  const rows = [...new Set(seats.map((s) => s.rowLabel))].sort()
  const { ref: rowsRef, update, overflowing, hidden } = useMoreToTheRight()
  return (
    <>
      <div
        ref={rowsRef}
        onScroll={update}
        className={`space-y-1.5 overflow-x-auto pb-2 ${hidden ? '[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)]' : ''}`}
      >
        {rows.map((rowLabel) => (
          <div key={rowLabel} className="flex items-center gap-1 whitespace-nowrap">
            <span className="sticky left-0 z-[1] w-7 shrink-0 bg-surface text-xs font-semibold text-slate-500">{rowLabel}</span>
            {seats
              .filter((s) => s.rowLabel === rowLabel)
              .sort((a, b) => a.seatNumber - b.seatNumber)
              .map((seat) => {
                const live = state.seats[seat.seatId]?.status ?? seat.status
                const selected = state.selected.includes(seat.seatId)
                // BKG-02: a seat my held order holds (HELD on everyone's map), which I may unpick or pick back.
                const mine = isMine(state, seat.seatId) && live === 'HELD'
                const typeIndex = reserved.findIndex((tt) => tt.id === seat.ticketTypeId)
                const typeColor = TYPE_COLORS[typeIndex % TYPE_COLORS.length]
                const sellable = (live === 'AVAILABLE' || mine) && typeIndex >= 0
                const color = selected
                  ? 'animate-pop bg-brand-800 text-white ring-2 ring-brand-300'
                  : mine
                    ? `${typeColor} text-white opacity-60 outline-2 outline-dashed outline-red-500`
                    : live === 'HELD'
                      ? 'bg-amber-200 text-amber-800'
                      : sellable
                        ? `${typeColor} text-white hover:-translate-y-px hover:brightness-110 hover:shadow-card`
                        : 'bg-slate-300 text-slate-500'
                const typeName = reserved[typeIndex]?.name ?? 'không bán'
                const statusText = mine
                  ? selected
                    ? 'ghế của bạn'
                    : 'ghế của bạn, sẽ bỏ ra khi cập nhật'
                  : live === 'AVAILABLE'
                    ? 'còn trống'
                    : live === 'HELD'
                      ? 'đang có người giữ'
                      : 'không còn'
                return (
                  <button
                    key={seat.seatId}
                    type="button"
                    disabled={!sellable && !selected}
                    aria-pressed={selected}
                    aria-label={`Ghế ${seat.code}, ${typeName}, ${statusText}`}
                    title={`${seat.code} · ${typeName}${seat.price ? ` · ${formatVnd(seat.price)}` : ''}`}
                    onClick={() => dispatch({ type: 'toggleSeat', seatId: seat.seatId })}
                    className={`h-8 w-8 shrink-0 rounded-md text-[11px] font-medium transition duration-150 ease-out enabled:active:scale-90 sm:h-9 sm:w-9 ${color} disabled:cursor-not-allowed`}
                  >
                    {seat.seatNumber}
                  </button>
                )
              })}
          </div>
        ))}
      </div>
      {overflowing && <p className="mt-1 text-xs text-slate-500">Hàng ghế dài hơn màn hình: vuốt ngang để xem hết.</p>}
    </>
  )
}

/**
 * A row of seats wider than the screen: fade its right edge while there is
 * more to see (the seats would otherwise just look cut off), and say so once.
 */
function useMoreToTheRight() {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState({ overflowing: false, hidden: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const overflowing = el.scrollWidth - el.clientWidth > 1
    const hidden = overflowing && el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setState((old) => (old.overflowing === overflowing && old.hidden === hidden ? old : { overflowing, hidden }))
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(el)
    update()
    return () => observer.disconnect()
  }, [update])
  return { ref, update, ...state }
}

function StandingZone({ name, ticketTypes, state, dispatch }: { name: string; ticketTypes: TicketTypeAvailability[]; state: SeatMapState; dispatch: (a: SeatMapAction) => void }) {
  if (ticketTypes.length === 0) return null
  return (
    <Card className="!p-4 sm:!p-5">
      <p className="mb-3 font-semibold text-ink">{name}</p>
      <div className="divide-y divide-line">
        {ticketTypes.map((tt) => {
          const left = state.gaAvailable[tt.id] ?? tt.available
          const quantity = state.gaQuantities[tt.id] ?? 0
          const set = (q: number) => dispatch({ type: 'setGaQuantity', ticketTypeId: tt.id, quantity: q })
          return (
            <div key={tt.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="font-medium text-ink">{tt.name}</p>
                <p className="text-sm">
                  <span className="font-semibold text-ink">{formatVnd(tt.price)}</span>
                  <span className={`ml-2 ${left === 0 ? 'text-red-600' : 'text-slate-500'}`}>{left === 0 ? 'Hết vé' : `Còn ${left} vé`}</span>
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-control border border-line p-1">
                <Button variant="ghost" size="sm" className="w-9 !px-0 text-lg" disabled={quantity === 0} onClick={() => set(quantity - 1)} aria-label={`Bớt ${tt.name}`}>
                  −
                </Button>
                <span className="w-8 text-center font-semibold text-ink" aria-live="polite">
                  {quantity}
                </span>
                {/* A held order's own standing tickets count as available to its buyer (BKG-02). */}
                <Button variant="ghost" size="sm" className="w-9 !px-0 text-lg" disabled={gaLeftFor(state, tt.id) === 0} onClick={() => set(quantity + 1)} aria-label={`Thêm ${tt.name}`}>
                  +
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

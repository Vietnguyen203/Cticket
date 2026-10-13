import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, toApiError } from '../../api/errors'
import { getEvent } from '../../api/events'
import { createOrder } from '../../api/orders'
import type { Seat, SeatMap, TicketTypeAvailability } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { Alert, Button, Card, FullPageSpinner } from '../../components/ui'
import { selectionSummary, MAX_TICKETS_PER_ORDER, type SeatMapAction, type SeatMapState } from '../../realtime/seatMapReducer'
import { useRealtimeState, useScheduleSeats } from '../../realtime/useScheduleSeats'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/** One colour per ticket type (in the order the API lists them). */
const TYPE_COLORS = ['bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500']

/** APP-C03: pick seats on the live map (and standing tickets), then hold them for 10 minutes. */
export function SeatSelectPage() {
  const { slug = '', scheduleId = '' } = useParams()
  const event = useAsync(() => getEvent(slug), `event:${slug}`)
  const { state, dispatch, error, reload } = useScheduleSeats(scheduleId)
  const connection = useRealtimeState()
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [holdError, setHoldError] = useState<ApiError | null>(null)

  const schedule = event.data?.schedules.find((s) => s.id === scheduleId)
  const summary = selectionSummary(state)

  async function hold() {
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
      const order = await createOrder(scheduleId, {
        ...(state.selected.length > 0 ? { seatIds: state.selected } : {}),
        ...(items.length > 0 ? { items } : {}),
      })
      navigate(`/orders/${order.id}`)
    } catch (err) {
      const apiError = toApiError(err)
      dispatch({ type: 'holdFailed' })
      setHoldError(apiError)
      if (['SEATS_UNAVAILABLE', 'INSUFFICIENT_INVENTORY'].includes(apiError.code)) void reload()
    }
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link to={`/events/${slug}`} className="text-sm text-brand-700 hover:underline">
            ← {event.data?.title ?? 'Sự kiện'}
          </Link>
          <h1 className="text-xl font-bold sm:text-2xl">Chọn chỗ</h1>
          {schedule && (
            <p className="text-sm text-slate-600">
              {formatDateTime(schedule.startAt)} · {schedule.venue.name}
            </p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            connection === 'open' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
          }`}
          title="Ghế đổi màu ngay khi người khác giữ / mua"
        >
          <span className={`h-2 w-2 rounded-full ${connection === 'open' ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
          {connection === 'open' ? 'Cập nhật trực tiếp' : 'Đang kết nối lại…'}
        </span>
      </div>

      <Notices state={state} map={map} dispatch={dispatch} holdError={holdError} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Legend ticketTypes={map.ticketTypes} />
          {map.zones.map((zone) =>
            zone.kind === 'SEATED' ? (
              <Card key={zone.id} className="!p-4">
                <p className="mb-3 text-sm font-semibold">{zone.name}</p>
                <div className="mb-3 rounded bg-slate-200 py-1 text-center text-[10px] uppercase tracking-widest text-slate-500">Sân khấu</div>
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
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="space-y-3 !p-4">
            <h2 className="font-semibold">Bạn đã chọn</h2>
            {summary.lines.length === 0 ? (
              <p className="text-sm text-slate-500">Chạm vào ghế trống trên sơ đồ, hoặc chọn số vé đứng.</p>
            ) : (
              <ul className="space-y-1 text-sm">
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
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
              <span>Tạm tính ({summary.count}/{MAX_TICKETS_PER_ORDER} vé)</span>
              <span>{formatVnd(summary.total)}</span>
            </div>
            <Button className="w-full" loading={state.holding} disabled={summary.count === 0} onClick={hold}>
              {status === 'authenticated' ? 'Giữ chỗ (10 phút)' : 'Đăng nhập để giữ chỗ'}
            </Button>
            <p className="text-xs text-slate-500">Giá cuối cùng do hệ thống tính lúc giữ chỗ. Ghế được giữ 10 phút để bạn thanh toán.</p>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function Notices({ state, map, dispatch, holdError }: { state: SeatMapState; map: SeatMap; dispatch: (a: SeatMapAction) => void; holdError: ApiError | null }) {
  const codeOf = (seatId: string) => map.zones.flatMap((z) => z.seats).find((s) => s.seatId === seatId)?.code ?? '?'
  const activeOrder = holdError?.code === 'ACTIVE_ORDER_EXISTS' ? (holdError.details as { orderId?: string } | undefined)?.orderId : undefined
  const takenSeats = holdError?.code === 'SEATS_UNAVAILABLE' && Array.isArray(holdError.details)
    ? (holdError.details as Array<{ seatId: string }>).map((d) => codeOf(d.seatId))
    : []
  return (
    <div className="mb-4 space-y-2">
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
    </div>
  )
}

function Legend({ ticketTypes }: { ticketTypes: TicketTypeAvailability[] }) {
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
  return (
    <div className="space-y-1 overflow-x-auto pb-1">
      {rows.map((rowLabel) => (
        <div key={rowLabel} className="flex items-center gap-1 whitespace-nowrap">
          <span className="w-6 shrink-0 text-xs font-semibold text-slate-500">{rowLabel}</span>
          {seats
            .filter((s) => s.rowLabel === rowLabel)
            .sort((a, b) => a.seatNumber - b.seatNumber)
            .map((seat) => {
              const live = state.seats[seat.seatId]?.status ?? seat.status
              const selected = state.selected.includes(seat.seatId)
              const typeIndex = reserved.findIndex((tt) => tt.id === seat.ticketTypeId)
              const sellable = live === 'AVAILABLE' && typeIndex >= 0
              const color = selected
                ? 'bg-brand-800 text-white ring-2 ring-brand-300'
                : live === 'HELD'
                  ? 'bg-amber-200 text-amber-800'
                  : sellable
                    ? `${TYPE_COLORS[typeIndex % TYPE_COLORS.length]} text-white hover:brightness-110`
                    : 'bg-slate-300 text-slate-500'
              const typeName = reserved[typeIndex]?.name ?? 'không bán'
              return (
                <button
                  key={seat.seatId}
                  type="button"
                  disabled={!sellable && !selected}
                  aria-pressed={selected}
                  aria-label={`Ghế ${seat.code}, ${typeName}, ${live === 'AVAILABLE' ? 'còn trống' : live === 'HELD' ? 'đang có người giữ' : 'không còn'}`}
                  title={`${seat.code} · ${typeName}${seat.price ? ` · ${formatVnd(seat.price)}` : ''}`}
                  onClick={() => dispatch({ type: 'toggleSeat', seatId: seat.seatId })}
                  className={`h-7 w-7 shrink-0 rounded-md text-[10px] font-medium transition sm:h-8 sm:w-8 ${color} disabled:cursor-not-allowed`}
                >
                  {seat.seatNumber}
                </button>
              )
            })}
        </div>
      ))}
    </div>
  )
}

function StandingZone({ name, ticketTypes, state, dispatch }: { name: string; ticketTypes: TicketTypeAvailability[]; state: SeatMapState; dispatch: (a: SeatMapAction) => void }) {
  if (ticketTypes.length === 0) return null
  return (
    <Card className="!p-4">
      <p className="mb-3 text-sm font-semibold">{name}</p>
      <div className="space-y-2">
        {ticketTypes.map((tt) => {
          const left = state.gaAvailable[tt.id] ?? tt.available
          const quantity = state.gaQuantities[tt.id] ?? 0
          const set = (q: number) => dispatch({ type: 'setGaQuantity', ticketTypeId: tt.id, quantity: q })
          return (
            <div key={tt.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {tt.name} · {formatVnd(tt.price)}
                </p>
                <p className={`text-xs ${left === 0 ? 'text-red-600' : 'text-slate-500'}`}>{left === 0 ? 'Hết vé' : `Còn ${left} vé`}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" className="!px-3" disabled={quantity === 0} onClick={() => set(quantity - 1)} aria-label={`Bớt ${tt.name}`}>
                  −
                </Button>
                <span className="w-6 text-center font-semibold" aria-live="polite">
                  {quantity}
                </span>
                <Button variant="secondary" className="!px-3" disabled={left === 0} onClick={() => set(quantity + 1)} aria-label={`Thêm ${tt.name}`}>
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

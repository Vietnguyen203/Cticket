import { useState } from 'react'
import { toApiError } from '../api/errors'
import { deleteTicketType, getCheckInStats } from '../api/organizer'
import { StatusBadge } from '../admin/components'
import { hasAny } from '../admin/permissions'
import { VenueZonesEditor } from '../admin/VenueZonesEditor'
import { useAuth } from '../auth/AuthContext'
import { Alert, Button, Card } from '../components/ui'
import { formatDateTime, formatVnd } from '../utils/format'
import { useAsync } from '../utils/useAsync'
import { SeatBlocker } from './SeatBlocker'
import { seatRangeLabel } from './allocation'
import { SeatPlanEditor } from './SeatPlanEditor'
import { TierPlanner } from './TierPlanner'
import { layoutSignature, venueGaps, type LoadedSchedule } from './setup'

/**
 * The ticket types and seats of one show (its date and times are edited in
 * the list above, ScheduleList); after publishing: seat blocks, check-ins.
 */
export function ScheduleCard({ setup, eventStatus, onChanged }: { setup: LoadedSchedule; eventStatus: string; onChanged: () => void }) {
  const { schedule, zones, layoutError } = setup
  const draft = eventStatus === 'DRAFT'

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{formatDateTime(schedule.startAt)}</p>
          <p className="text-sm text-slate-600">
            {schedule.venue.name} · {schedule.venue.city}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Kết thúc {formatDateTime(schedule.endAt)} · mở bán {formatDateTime(schedule.salesStartAt)} → {formatDateTime(schedule.salesEndAt)}
          </p>
        </div>
        <StatusBadge status={schedule.status} />
      </div>

      {/* The organizer's order: the total, then the seated tiers, then the standing ones; the tiers so far below. */}
      {draft && <TierPlanner setup={setup} onChanged={onChanged} />}
      <TicketTypesTable setup={setup} draft={draft} onChanged={onChanged} />
      {draft && layoutError && (
        <Alert>
          Không tải được khu và ghế của địa điểm ({layoutError}), nên chưa gán ghế được.{' '}
          <button type="button" onClick={onChanged} className="font-semibold underline">
            Thử lại
          </button>
        </Alert>
      )}
      {draft && zones && <VenueGapsNotice setup={setup} onChanged={onChanged} />}
      {draft && zones && <AdvancedSeatPlan setup={setup} onChanged={onChanged} />}
      {schedule.inventoryGeneratedAt && schedule.status === 'SCHEDULED' && (
        <>
          <SeatBlocker scheduleId={schedule.id} />
          <CheckInSummary scheduleId={schedule.id} />
        </>
      )}

    </Card>
  )
}

function TicketTypesTable({ setup, draft, onChanged }: { setup: LoadedSchedule; draft: boolean; onChanged: () => void }) {
  const { ticketTypes, seatsByTicketType, unassignedSeats, zones, plan } = setup
  const seatsOf = (id: string) => plan.assignments.filter((a) => a.ticketTypeId === id).map((a) => a.seatId)
  const [error, setError] = useState<string | null>(null)
  const zoneName = (id: string | null | undefined) => zones?.find((z) => z.id === id)?.name

  async function remove(id: string) {
    setError(null)
    try {
      await deleteTicketType(id)
      onChanged()
    } catch (err) {
      setError(toApiError(err).message)
    }
  }

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold">Hạng vé</h4>
      {error && <Alert>{error}</Alert>}
      {ticketTypes.length === 0 ? (
        <p className="text-sm text-amber-700">Chưa có hạng vé.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-4">Hạng</th>
                <th className="py-1 pr-4">Loại</th>
                <th className="py-1 pr-4">Giá</th>
                <th className="py-1 pr-4">Số lượng</th>
                <th className="py-1 pr-4">Tối đa / đơn</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ticketTypes.map((tt) => (
                <tr key={tt.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 font-medium">
                    {tt.name} <span className="text-xs text-slate-400">{tt.code}</span>
                  </td>
                  <td className="py-1.5 pr-4 text-slate-600">{tt.inventoryMode === 'RESERVED'
                      ? `Ghế ngồi${zones && seatsOf(tt.id).length ? ` · ${seatRangeLabel(zones, seatsOf(tt.id))}` : ''}`
                      : `Vé đứng${zoneName(tt.venueZoneId) ? ` · ${zoneName(tt.venueZoneId)}` : ''}`}</td>
                  <td className="py-1.5 pr-4">{formatVnd(tt.price)}</td>
                  <td className={`py-1.5 pr-4 ${tt.inventoryMode === 'RESERVED' && !seatsByTicketType[tt.id] ? 'text-amber-700' : 'text-slate-600'}`}>
                    {tt.inventoryMode === 'RESERVED' ? `${seatsByTicketType[tt.id] ?? 0} ghế` : `${tt.capacity} vé`}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-600">{tt.maxPerOrder}</td>
                  <td className="py-1.5 text-right">
                    {draft && (
                      <button type="button" onClick={() => void remove(tt.id)} className="text-xs font-semibold text-red-600 hover:underline">
                        Xóa
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unassignedSeats > 0 && <p className="mt-1 text-xs text-slate-500">{unassignedSeats} ghế chưa thuộc hạng vé nào (không bán).</p>}
    </div>
  )
}

/**
 * Seats by row ("Gán ghế theo hàng"), for what the automatic split does not
 * cover: moving rows between tiers. Folded away, open when a seated tier has
 * no seats yet (older tiers, or a venue that just got its seats).
 */
function AdvancedSeatPlan({ setup, onChanged }: { setup: LoadedSchedule; onChanged: () => void }) {
  const { schedule, ticketTypes, plan, zones, seatsByTicketType } = setup
  const waiting = ticketTypes.some((tt) => tt.inventoryMode === 'RESERVED' && tt.status === 'ACTIVE' && !seatsByTicketType[tt.id])
  const [open, setOpen] = useState(waiting)
  if (!zones || !ticketTypes.some((tt) => tt.inventoryMode === 'RESERVED')) return null
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-sm font-semibold text-brand-700 hover:underline" aria-expanded={open}>
        {open ? '− Ẩn gán ghế theo hàng' : '+ Gán ghế theo hàng (nâng cao)'}
      </button>
      {open && (
        <SeatPlanEditor
          key={`${plan.totalAssignedSeats}:${ticketTypes.length}:${Object.values(seatsByTicketType).join()}`}
          scheduleId={schedule.id}
          zones={zones}
          plan={plan}
          ticketTypes={ticketTypes}
          onSaved={onChanged}
        />
      )}
    </div>
  )
}

/**
 * What the schedule's venue cannot sell yet: seats never generated, no
 * standing zone. Without this, the seat plan simply did not show: a "Ghế
 * ngồi" ticket type could never get seats and the event could never be
 * submitted, with nothing on the page saying why.
 */
function VenueGapsNotice({ setup, onChanged }: { setup: LoadedSchedule; onChanged: () => void }) {
  const { schedule, ticketTypes, zones, venuePending } = setup
  const [open, setOpen] = useState(false)
  // Venue managers (admins) change any venue; an organizer only their own proposal, while it is PENDING.
  const { user } = useAuth()
  const canBuild = venuePending || hasAny(user, ['venue:manage'])
  const gaps = venueGaps(schedule.venue.name, zones ?? [], ticketTypes)
  if (!gaps) return null
  const before = layoutSignature(zones ?? [])

  return (
    <div className={`space-y-3 rounded-lg border p-3 text-sm ${gaps.blocking ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <p className={gaps.blocking ? 'text-amber-800' : 'text-slate-600'}>{gaps.message}</p>
      {canBuild ? (
        <>
          <Button type="button" variant="secondary" onClick={() => setOpen((o) => !o)}>
            {open ? 'Đóng phần khu và ghế' : 'Thêm khu / ghế cho địa điểm này'}
          </Button>
          {open && (
            <VenueZonesEditor
              venueId={schedule.venue.id}
              // Seats or standing zones added: reload the schedule (the seat plan / the zone choice appears).
              onLayout={(next) => layoutSignature(next) !== before && onChanged()}
            />
          )}
        </>
      ) : (
        <p className="text-slate-600">
          Địa điểm đã được duyệt nên chỉ quản trị viên thêm khu / ghế được. Cách khác: dùng loại vé địa điểm đang bán được, hoặc "Xóa suất" rồi thêm
          lại với địa điểm khác.
        </p>
      )}
    </div>
  )
}

function CheckInSummary({ scheduleId }: { scheduleId: string }) {
  const stats = useAsync(() => getCheckInStats(scheduleId), `checkin:${scheduleId}`)
  if (!stats.data) return null
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">Check-in</h4>
      <p className="text-sm text-slate-700">
        Đã vào <strong>{stats.data.checkedIn}</strong> / {stats.data.total} vé
        {stats.data.byTicketType.length > 0 && ` (${stats.data.byTicketType.map((t) => `${t.ticketTypeName} ${t.checkedIn}/${t.total}`).join(', ')})`}
        <button type="button" onClick={stats.reload} className="ml-2 text-xs font-semibold text-brand-700 hover:underline">
          Tải lại
        </button>
      </p>
    </div>
  )
}

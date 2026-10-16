import { useState, type FormEvent } from 'react'
import type { LayoutZone } from '../api/admin'
import { ApiError, toApiError } from '../api/errors'
import { createTicketType, deleteSchedule, deleteTicketType, getCheckInStats, updateSchedule, type TicketTypeInput } from '../api/organizer'
import { ConfirmDialog, StatusBadge } from '../admin/components'
import { DateTimeField } from '../components/DateTimeField'
import { Alert, Button, Card, TextField } from '../components/ui'
import { formatDateTime, formatVnd } from '../utils/format'
import { useAsync } from '../utils/useAsync'
import { fromVnInput, toVnInput } from '../utils/vnTime'
import { SeatBlocker } from './SeatBlocker'
import { SeatPlanEditor } from './SeatPlanEditor'
import type { LoadedSchedule } from './setup'

/** One schedule in the event editor: times, ticket types, seat plan; after publishing: seat blocks, check-ins. */
export function ScheduleCard({ setup, eventStatus, onChanged }: { setup: LoadedSchedule; eventStatus: string; onChanged: () => void }) {
  const { schedule, ticketTypes, plan, zones, seatsByTicketType } = setup
  const draft = eventStatus === 'DRAFT'
  const live = eventStatus === 'PUBLISHED' && schedule.status === 'SCHEDULED'
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null)

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
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={schedule.status} />
          {draft && (
            <>
              <Button variant="ghost" onClick={() => setEditing((e) => !e)}>
                Sửa giờ
              </Button>
              <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setConfirm('delete')}>
                Xóa suất
              </Button>
            </>
          )}
          {live && (
            <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setConfirm('cancel')}>
              Hủy suất
            </Button>
          )}
        </div>
      </div>

      {editing && <ScheduleTimesForm setup={setup} onSaved={() => { setEditing(false); onChanged() }} />}

      <TicketTypesTable setup={setup} draft={draft} onChanged={onChanged} />
      {draft && <NewTicketType scheduleId={schedule.id} zones={zones} onCreated={onChanged} />}
      {draft && zones && (
        <SeatPlanEditor
          key={`${plan.totalAssignedSeats}:${ticketTypes.length}:${Object.values(seatsByTicketType).join()}`}
          scheduleId={schedule.id}
          zones={zones}
          plan={plan}
          ticketTypes={ticketTypes}
          onSaved={onChanged}
        />
      )}
      {schedule.inventoryGeneratedAt && schedule.status === 'SCHEDULED' && (
        <>
          <SeatBlocker scheduleId={schedule.id} />
          <CheckInSummary scheduleId={schedule.id} />
        </>
      )}

      {confirm && (
        <ConfirmDialog
          open
          title={confirm === 'delete' ? 'Xóa suất diễn này?' : 'Hủy suất diễn này?'}
          message={
            confirm === 'cancel'
              ? 'Không thể hoàn tác. Đơn đang giữ chỗ bị hủy, đơn đã thanh toán được hoàn tiền.'
              : 'Suất diễn cùng hạng vé và sơ đồ ghế của nó bị xóa.'
          }
          confirmLabel={confirm === 'delete' ? 'Xóa' : 'Hủy suất'}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              if (confirm === 'delete') await deleteSchedule(schedule.id)
              else await updateSchedule(schedule.id, { status: 'CANCELLED' })
            } catch (err) {
              throw toApiError(err)
            }
            onChanged()
          }}
        />
      )}
    </Card>
  )
}

function ScheduleTimesForm({ setup, onSaved }: { setup: LoadedSchedule; onSaved: () => void }) {
  const { schedule } = setup
  const [form, setForm] = useState({
    startAt: toVnInput(schedule.startAt),
    endAt: toVnInput(schedule.endAt),
    salesStartAt: toVnInput(schedule.salesStartAt),
    salesEndAt: toVnInput(schedule.salesEndAt),
  })
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = Object.fromEntries(
        (Object.entries(form) as Array<[keyof typeof form, string]>)
          .filter(([key, value]) => value !== toVnInput(schedule[key]))
          .map(([key, value]) => [key, fromVnInput(value)]),
      )
      if (Object.keys(body).length > 0) await updateSchedule(schedule.id, body)
      onSaved()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <Alert>{error.message}</Alert>
        </div>
      )}
      {(['startAt', 'endAt', 'salesStartAt', 'salesEndAt'] as const).map((key) => (
        <DateTimeField
          key={key}
          label={{ startAt: 'Bắt đầu', endAt: 'Kết thúc', salesStartAt: 'Mở bán', salesEndAt: 'Đóng bán' }[key] + ' (giờ VN)'}
          name={key}
          value={form[key]}
          onChange={(value) => setForm((f) => ({ ...f, [key]: value }))}
        />
      ))}
      <div className="sm:col-span-2">
        <Button type="submit" loading={busy}>
          Lưu giờ
        </Button>
      </div>
    </form>
  )
}

function TicketTypesTable({ setup, draft, onChanged }: { setup: LoadedSchedule; draft: boolean; onChanged: () => void }) {
  const { ticketTypes, seatsByTicketType, unassignedSeats, zones } = setup
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
                  <td className="py-1.5 pr-4 text-slate-600">{tt.inventoryMode === 'RESERVED' ? 'Ghế ngồi' : `Vé đứng${zoneName(tt.venueZoneId) ? ` · ${zoneName(tt.venueZoneId)}` : ''}`}</td>
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

const EMPTY_TICKET = { code: '', name: '', price: '', inventoryMode: 'RESERVED' as TicketTypeInput['inventoryMode'], capacity: '', venueZoneId: '', maxPerOrder: '' }

function NewTicketType({ scheduleId, zones, onCreated }: { scheduleId: string; zones: LayoutZone[] | null; onCreated: () => void }) {
  const [form, setForm] = useState(EMPTY_TICKET)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const standing = zones?.filter((z) => z.kind === 'STANDING') ?? []
  const ga = form.inventoryMode === 'GENERAL_ADMISSION'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      await createTicketType(scheduleId, {
        code: form.code.trim(),
        name: form.name.trim(),
        price: Number(form.price),
        inventoryMode: form.inventoryMode,
        ...(ga ? { capacity: Number(form.capacity), venueZoneId: form.venueZoneId || null } : {}),
        ...(form.maxPerOrder ? { maxPerOrder: Number(form.maxPerOrder) } : {}),
      })
      setForm({ ...EMPTY_TICKET, inventoryMode: form.inventoryMode })
      onCreated()
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof EMPTY_TICKET) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-dashed border-slate-300 p-3" noValidate>
      <h4 className="text-sm font-semibold">Thêm hạng vé</h4>
      {error && <Alert>{error.message}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Mã" name="ttCode" placeholder="VIP" value={form.code} onChange={set('code')} error={fieldErrors.code} />
        <TextField label="Tên" name="ttName" placeholder="Hạng VIP" value={form.name} onChange={set('name')} error={fieldErrors.name} />
        <TextField label="Giá (VND)" name="ttPrice" type="number" min={0} step={1000} value={form.price} onChange={set('price')} error={fieldErrors.price} />
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Loại</span>
          <select value={form.inventoryMode} onChange={set('inventoryMode')} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">
            <option value="RESERVED">Ghế ngồi (chọn ghế)</option>
            <option value="GENERAL_ADMISSION">Vé đứng (theo số lượng)</option>
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            {ga
              ? 'Bán theo số lượng, không gắn ghế: không hiện trong phần "Gán hàng ghế".'
              : 'Gắn với ghế: sau khi thêm, chọn hàng ghế cho hạng này ở phần "Gán hàng ghế" bên dưới.'}
          </span>
        </label>
        {ga && (
          <>
            <TextField label="Số vé" name="ttCapacity" type="number" min={1} value={form.capacity} onChange={set('capacity')} error={fieldErrors.capacity} />
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Khu đứng</span>
              <select value={form.venueZoneId} onChange={set('venueZoneId')} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">
                <option value="">(không gắn khu)</option>
                {standing.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.capacity} chỗ)
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <TextField label="Tối đa / đơn (mặc định 10)" name="ttMax" type="number" min={1} max={50} value={form.maxPerOrder} onChange={set('maxPerOrder')} error={fieldErrors.maxPerOrder} />
      </div>
      <Button type="submit" loading={busy} disabled={!form.code || !form.name || form.price === '' || (ga && !form.capacity)}>
        Thêm hạng vé
      </Button>
    </form>
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

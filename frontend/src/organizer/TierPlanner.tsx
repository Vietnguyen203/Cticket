import { useState, type FormEvent } from 'react'
import { ApiError, toApiError } from '../api/errors'
import { createTicketType, deleteTicketType, saveSeatPlan, updateSchedule } from '../api/organizer'
import { Alert, Button, TextField } from '../components/ui'
import { venueCapacityMessage, zonePlaces } from '../admin/venueCapacity'
import { allocation, freeSeats, planWith, takeSeats } from './allocation'
import type { LoadedSchedule } from './setup'

/**
 * Planning the places of a DRAFT show, in the organizer's order:
 *  1. the total attendance ("Tổng số người tham dự"),
 *  2. seated tiers: a number of seats each, taken from the venue front rows first,
 *  3. standing tiers: a number of tickets each, in a standing zone.
 * "Đã xếp X / Y · còn lại Z" follows every change; the API refuses more than Y.
 */
export function TierPlanner({ setup, onChanged }: { setup: LoadedSchedule; onChanged: () => void }) {
  const { schedule, ticketTypes, seatsByTicketType, zones, plan } = setup
  const split = allocation(schedule.capacity, ticketTypes, seatsByTicketType)
  const free = zones ? freeSeats(zones, plan).length : 0

  return (
    <div className="space-y-4">
      <CapacityForm setup={setup} allocated={split.allocated} onChanged={onChanged} />
      {schedule.capacity ? (
        <p className={`rounded-lg px-3 py-2 text-sm ${split.remaining! < 0 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-700'}`} data-testid="allocation">
          Đã xếp <strong>{split.allocated.toLocaleString('vi-VN')}</strong> / {schedule.capacity.toLocaleString('vi-VN')} người · ghế ngồi{' '}
          {split.seated.toLocaleString('vi-VN')} · đứng {split.standing.toLocaleString('vi-VN')} · còn lại{' '}
          <strong>{split.remaining!.toLocaleString('vi-VN')}</strong>
        </p>
      ) : (
        <p className="text-sm text-amber-700">Nhập tổng số người tham dự trước, rồi chia vào các hạng ghế ngồi và hạng đứng.</p>
      )}
      {schedule.capacity && (
        <div className="grid gap-4 lg:grid-cols-2">
          <TierForm setup={setup} mode="RESERVED" remaining={split.remaining ?? 0} freeSeats={free} onCreated={onChanged} />
          <TierForm setup={setup} mode="GENERAL_ADMISSION" remaining={split.remaining ?? 0} freeSeats={free} onCreated={onChanged} />
        </div>
      )}
    </div>
  )
}

/**
 * "Tổng số người tham dự", in step with the venue: it starts at the venue's
 * capacity ("Sức chứa"), may be lower, never higher; "Đồng bộ" sets it back.
 * The places the venue's zones really have are shown too: a total above them
 * could never be filled.
 */
function CapacityForm({ setup, allocated, onChanged }: { setup: LoadedSchedule; allocated: number; onChanged: () => void }) {
  const { schedule, venueCapacity, zones } = setup
  const [value, setValue] = useState(String(schedule.capacity ?? venueCapacity ?? ''))
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const number = Number(value)
  const valid = Number.isInteger(number) && number >= 1 && number <= 1_000_000
  const tooSmall = valid && number < allocated
  const tooBig = valid && venueCapacity !== null && number > venueCapacity
  const places = zones ? zonePlaces(zones) : null
  const n = (x: number) => x.toLocaleString('vi-VN')

  async function save(capacity: number) {
    setBusy(true)
    setError(null)
    try {
      await updateSchedule(schedule.id, { capacity })
      setValue(String(capacity))
      onChanged()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        void save(number)
      }}
      className="space-y-2"
      noValidate
    >
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          label="Tổng số người tham dự"
          name={`capacity-${schedule.id}`}
          type="number"
          min={1}
          max={venueCapacity ?? undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={tooSmall ? `Các hạng đã xếp ${n(allocated)} người.` : tooBig ? `Địa điểm chỉ chứa ${n(venueCapacity!)} người.` : undefined}
        />
        <Button type="submit" variant="secondary" loading={busy} disabled={!valid || tooSmall || tooBig || number === schedule.capacity}>
          Lưu tổng
        </Button>
        {venueCapacity !== null && schedule.capacity !== venueCapacity && allocated <= venueCapacity && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(venueCapacity)}>
            Đồng bộ với sức chứa địa điểm ({n(venueCapacity)})
          </Button>
        )}
      </div>
      <p className="text-sm text-slate-600">
        {venueCapacity !== null ? (
          <>
            Sức chứa địa điểm: <strong>{n(venueCapacity)}</strong>
            {schedule.capacity === venueCapacity ? ' (đang đồng bộ)' : ''}
          </>
        ) : (
          'Địa điểm chưa có sức chứa: nhờ quản trị viên nhập để giới hạn số vé.'
        )}
        {places && ` · các khu: ${n(places.total)} chỗ (${n(places.seats)} ghế + ${n(places.standing)} đứng)`}
      </p>
      {!schedule.capacity && venueCapacity !== null && (
        <p className="text-sm text-amber-700">Chưa lưu: bấm "Lưu tổng" để dùng sức chứa địa điểm ({n(venueCapacity)}) làm tổng.</p>
      )}
      {places && valid && number > places.total && (
        <p className="text-sm text-amber-700">
          Các khu của địa điểm chỉ có {n(places.total)} chỗ: tối đa xếp được {n(places.total)} người, {n(number - places.total)} người còn lại không có chỗ.
        </p>
      )}
      {error && <Alert>{venueCapacityMessage(error) ?? error.message}</Alert>}
    </form>
  )
}

const EMPTY = { code: '', name: '', price: '', count: '', venueZoneId: '', maxPerOrder: '' }

/** A seated tier (N seats, taken from the venue) or a standing tier (N tickets in a standing zone). */
function TierForm({
  setup,
  mode,
  remaining,
  freeSeats: free,
  onCreated,
}: {
  setup: LoadedSchedule
  mode: 'RESERVED' | 'GENERAL_ADMISSION'
  remaining: number
  freeSeats: number
  onCreated: () => void
}) {
  const { schedule, zones, plan } = setup
  const seated = mode === 'RESERVED'
  const standing = zones?.filter((z) => z.kind === 'STANDING') ?? []
  const [form, setForm] = useState(EMPTY)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const zoneId = standing.some((z) => z.id === form.venueZoneId) ? form.venueZoneId : (standing[0]?.id ?? '')
  const count = Number(form.count)
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  // Why it cannot be added, in words (null: it can).
  const blocked = !zones
    ? 'Chưa tải được khu và ghế của địa điểm.'
    : seated && free === 0
      ? 'Địa điểm không còn ghế trống để xếp hạng mới.'
      : !seated && standing.length === 0
        ? 'Địa điểm chưa có khu đứng.'
        : remaining <= 0
          ? 'Đã xếp đủ tổng số người tham dự.'
          : null
  const countProblem =
    form.count === '' || blocked
      ? null
      : !Number.isInteger(count) || count < 1
        ? 'Nhập một số nguyên dương.'
        : count > remaining
          ? `Chỉ còn ${remaining.toLocaleString('vi-VN')} người chưa xếp.`
          : seated && count > free
            ? `Địa điểm chỉ còn ${free.toLocaleString('vi-VN')} ghế trống.`
            : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const seatIds = seated && zones ? takeSeats(zones, plan, count) : null
      if (seated && !seatIds) throw new Error(`Địa điểm chỉ còn ${free} ghế trống.`)
      const created = await createTicketType(schedule.id, {
        code: form.code.trim(),
        name: form.name.trim(),
        price: Number(form.price),
        inventoryMode: mode,
        ...(seated ? {} : { capacity: count, venueZoneId: zoneId }),
        ...(form.maxPerOrder ? { maxPerOrder: Number(form.maxPerOrder) } : {}),
      })
      if (seated) {
        try {
          await saveSeatPlan(schedule.id, planWith(plan, created.id, seatIds!))
        } catch (err) {
          // The tier without its seats would be a dead end: take it back.
          await deleteTicketType(created.id).catch(() => undefined)
          throw err
        }
      }
      setForm(EMPTY)
      onCreated()
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(err instanceof Error && !(err instanceof ApiError) ? err.message : apiError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-dashed border-slate-300 p-3" noValidate>
      <div>
        <h4 className="text-sm font-semibold">{seated ? 'Thêm hạng ghế ngồi' : 'Thêm hạng đứng'}</h4>
        <p className="text-xs text-slate-500">
          {seated
            ? `Hệ thống tự xếp ghế từ hàng đầu xuống; khách chọn ghế trên sơ đồ. Còn ${free.toLocaleString('vi-VN')} ghế trống.`
            : 'Bán theo số lượng, trong một khu đứng của địa điểm.'}
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {blocked ? (
        <p className="text-sm text-amber-700">{blocked}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Mã" name={`${mode}-code`} placeholder={seated ? 'VIP' : 'GA'} value={form.code} onChange={set('code')} error={fieldErrors.code} />
            <TextField label="Tên" name={`${mode}-name`} placeholder={seated ? 'Hạng VIP' : 'Vé đứng'} value={form.name} onChange={set('name')} error={fieldErrors.name} />
            <TextField label="Giá (VND)" name={`${mode}-price`} type="number" min={0} step={1000} value={form.price} onChange={set('price')} error={fieldErrors.price} />
            <TextField
              label={seated ? 'Số ghế' : 'Số vé đứng'}
              name={`${mode}-count`}
              type="number"
              min={1}
              value={form.count}
              onChange={set('count')}
              error={countProblem ?? fieldErrors.capacity}
            />
            {!seated && (
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700">Khu đứng</span>
                <select value={zoneId} onChange={set('venueZoneId')} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">
                  {standing.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} ({z.capacity} chỗ)
                    </option>
                  ))}
                </select>
              </label>
            )}
            <TextField
              label="Tối đa / đơn (mặc định 10)"
              name={`${mode}-max`}
              type="number"
              min={1}
              max={50}
              value={form.maxPerOrder}
              onChange={set('maxPerOrder')}
              error={fieldErrors.maxPerOrder}
            />
          </div>
          <Button type="submit" loading={busy} disabled={!form.code || !form.name || form.price === '' || !form.count || Boolean(countProblem)}>
            {seated ? 'Thêm hạng ghế' : 'Thêm hạng đứng'}
          </Button>
        </>
      )}
    </form>
  )
}

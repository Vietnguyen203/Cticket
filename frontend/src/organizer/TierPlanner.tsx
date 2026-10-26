import { useState, type FormEvent } from 'react'
import { ApiError, toApiError } from '../api/errors'
import { createTicketType, deleteTicketType, saveSeatPlan, updateSchedule } from '../api/organizer'
import { Alert, Button, TextField } from '../components/ui'
import { venueCapacityMessage, zonePlaces } from '../admin/venueCapacity'
import { formatVnd } from '../utils/format'
import { allocation, freeSeatsOfZones, planWith, planWithout, tierCode, zoneLines, type ZoneLine } from './allocation'
import type { LoadedSchedule } from './setup'

/**
 * Planning the places of a DRAFT show, in the organizer's order:
 *  1. the total attendance ("Tổng số người tham dự"),
 *  2. a tier for each zone the venue already has (seated: its seats; standing: a number of tickets).
 * "Đã xếp X / Y · còn lại Z" follows every change; the API refuses more than Y.
 */
export function TierPlanner({ setup, onChanged }: { setup: LoadedSchedule; onChanged: () => void }) {
  const { schedule, ticketTypes, seatsByTicketType } = setup
  const split = allocation(schedule.capacity, ticketTypes, seatsByTicketType)

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
      {schedule.capacity && <ZoneTierTable setup={setup} remaining={split.remaining ?? 0} onChanged={onChanged} />}
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

/**
 * "Hạng vé theo khu": the venue already has its zones, so a tier is given to
 * a zone, not created out of nothing. A seated zone sells all its free seats
 * (buyers pick them on the map); a standing zone sells a number of tickets, at
 * most its capacity. Each line: tier name (the zone's name by default), price,
 * max per order, "Gán"; a zone with a tier shows it, with "Bỏ gán".
 */
function ZoneTierTable({ setup, remaining, onChanged }: { setup: LoadedSchedule; remaining: number; onChanged: () => void }) {
  const { zones, plan, ticketTypes } = setup
  if (!zones) return <p className="text-sm text-amber-700">Chưa tải được khu và ghế của địa điểm.</p>
  const lines = zoneLines(zones, plan, ticketTypes)
  if (lines.length === 0) return <p className="text-sm text-amber-700">Địa điểm chưa có khu nào có chỗ (khu ngồi chưa có ghế, chưa có khu đứng).</p>
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">Hạng vé theo khu của địa điểm</h4>
      <p className="mb-2 text-xs text-slate-500">
        Gán hạng và giá cho từng khu có sẵn. Khu ngồi bán toàn bộ ghế trống của khu (khách chọn ghế trên sơ đồ); khu đứng bán theo số lượng, tối đa
        bằng sức chứa của khu.
      </p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {lines.map((line) => (
          <ZoneTierLine key={line.zone.id} line={line} setup={setup} remaining={remaining} onChanged={onChanged} />
        ))}
      </ul>
    </div>
  )
}

function ZoneTierLine({ line, setup, remaining, onChanged }: { line: ZoneLine; setup: LoadedSchedule; remaining: number; onChanged: () => void }) {
  const { schedule, zones, plan, ticketTypes } = setup
  const { zone, seated } = line
  const [name, setName] = useState(zone.name)
  const [price, setPrice] = useState('')
  // The number typed; until then, what the zone has left within the total (follows every change).
  const [typed, setTyped] = useState<string | null>(null)
  const count = typed ?? String(Math.max(0, Math.min(line.free, remaining)))
  const [maxPerOrder, setMaxPerOrder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const n = (x: number) => x.toLocaleString('vi-VN')

  // Seated: that many of the zone's free seats, front rows first. Standing: that many tickets.
  const places = Number(count)
  const problem =
    line.free === 0
      ? null
      : !Number.isInteger(places) || places < 1
        ? seated
          ? 'Nhập số ghế (số nguyên dương).'
          : 'Nhập số vé (số nguyên dương).'
        : places > line.free
          ? `Khu còn ${n(line.free)} ${seated ? 'ghế trống' : 'chỗ'}.`
          : places > remaining
            ? `Chỉ còn ${n(Math.max(0, remaining))} người chưa xếp (tổng số người tham dự).`
            : null

  async function assign(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const code = tierCode(zone.code, ticketTypes.map((tt) => tt.code))
      const created = await createTicketType(schedule.id, {
        code,
        name: name.trim(),
        price: Number(price),
        inventoryMode: seated ? 'RESERVED' : 'GENERAL_ADMISSION',
        ...(seated ? {} : { capacity: places, venueZoneId: zone.id }),
        ...(maxPerOrder ? { maxPerOrder: Number(maxPerOrder) } : {}),
      })
      if (seated && zones) {
        try {
          await saveSeatPlan(schedule.id, planWith(plan, created.id, freeSeatsOfZones(zones, plan, [zone.id]).slice(0, places)))
        } catch (err) {
          // A seated tier without its seats would be a dead end: take it back.
          await deleteTicketType(created.id).catch(() => undefined)
          throw err
        }
      }
      setPrice('')
      setTyped(null)
      onChanged()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Takes the tier off THIS zone. A seated tier that also has seats in other
   * zones (rows set with the advanced editor) keeps them: only this zone's
   * seats leave it. Otherwise the tier itself goes.
   */
  async function unassign(id: string) {
    setBusy(true)
    setError(null)
    try {
      const zoneSeats = new Set(zone.seats.map((s) => s.id))
      const elsewhere = seated && plan.assignments.some((a) => a.ticketTypeId === id && !zoneSeats.has(a.seatId))
      if (elsewhere) await saveSeatPlan(schedule.id, planWithout(plan, id, [...zoneSeats]))
      else await deleteTicketType(id)
      setTyped(null)
      onChanged()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="space-y-2 p-3" aria-label={`Khu ${zone.name}`}>
      <p className="text-sm">
        <strong>{zone.name}</strong>{' '}
        <span className="text-slate-500">
          · {seated ? `khu ngồi, ${n(line.places)} ghế` : `khu đứng, ${n(line.places)} chỗ`}
          {line.tiers.length > 0 && line.free > 0 && ` · còn ${n(line.free)} ${seated ? 'ghế' : 'chỗ'} chưa gán`}
        </span>
      </p>
      {line.tiers.map((tier) => (
        <div key={tier.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-brand-50/60 px-3 py-2 text-sm">
          <span>
            <strong>{tier.name}</strong> · {formatVnd(tier.price)} · {n(tier.places)} {seated ? 'ghế' : 'vé'}
          </span>
          <Button type="button" variant="ghost" className="ml-auto text-red-600 hover:bg-red-50" disabled={busy} onClick={() => void unassign(tier.id)}>
            Bỏ gán
          </Button>
        </div>
      ))}
      {error && <Alert>{error}</Alert>}
      {line.free > 0 && (
        <form onSubmit={assign} className="flex flex-wrap items-end gap-2" noValidate aria-label={`Gán hạng cho ${zone.name}`}>
          <TextField label="Tên hạng" name={`tier-name-${zone.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Giá (VND)" name={`tier-price-${zone.id}`} type="number" min={0} step={1000} value={price} onChange={(e) => setPrice(e.target.value)} />
          <TextField
            label={seated ? 'Số ghế' : 'Số vé'}
            name={`tier-count-${zone.id}`}
            type="number"
            min={1}
            max={line.free}
            value={count}
            onChange={(e) => setTyped(e.target.value)}
          />
          <TextField
            label="Tối đa / đơn"
            name={`tier-max-${zone.id}`}
            type="number"
            min={1}
            max={50}
            placeholder="10"
            value={maxPerOrder}
            onChange={(e) => setMaxPerOrder(e.target.value)}
          />
          <Button type="submit" loading={busy} disabled={!name.trim() || price === '' || Boolean(problem)}>
            {seated ? `Gán ${n(places > 0 ? places : line.free)} ghế` : 'Gán'}
          </Button>
          {problem && <p className="w-full text-sm text-red-600">{problem}</p>}
        </form>
      )}
    </li>
  )
}

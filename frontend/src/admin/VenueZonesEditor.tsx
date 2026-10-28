import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createSeats, createZone, getVenueLayout, type LayoutZone, type ZoneKind } from '../api/admin'
import { ApiError, toApiError } from '../api/errors'
import { Alert, Button, Card, NumberField, TextField } from '../components/ui'
import { useAsync } from '../utils/useAsync'
import { parseRowLabels } from './rowLabels'
import { venueCapacityMessage, zonePlaces } from './venueCapacity'

const MAX_SEAT_NUMBER = 999

/**
 * Zones of a venue with their seats, a form to add rows of seats, and a form
 * to add a zone. onLayout: the zones after every load (what the venue can sell).
 */
export function VenueZonesEditor({ venueId, onLayout }: { venueId: string; onLayout?: (zones: LayoutZone[]) => void }) {
  const layout = useAsync(() => getVenueLayout(venueId), `layout:${venueId}`)
  // Called once per load, whatever function the parent passes on each render.
  const onLayoutRef = useRef(onLayout)
  useEffect(() => {
    onLayoutRef.current = onLayout
  })
  useEffect(() => {
    if (layout.data) onLayoutRef.current?.(layout.data.zones)
  }, [layout.data])
  return (
    <div className="space-y-4">
      {layout.error && <Alert>{layout.error.message}</Alert>}
      {layout.data && <PlacesLine capacity={layout.data.venue.capacity ?? null} zones={layout.data.zones} />}
      {layout.data?.zones.map((zone) => <ZoneCard key={zone.id} zone={zone} onChanged={layout.reload} />)}
      {layout.data?.zones.length === 0 && <p className="text-sm text-slate-500">Chưa có khu nào. Thêm khu ngồi hoặc khu đứng bên dưới.</p>}
      <NewZone venueId={venueId} onCreated={layout.reload} />
    </div>
  )
}

/** Seats of a SEATED zone, one line per row; STANDING zones only have a capacity. */
function ZoneCard({ zone, onChanged }: { zone: LayoutZone; onChanged: () => void }) {
  const rows = new Map<string, string[]>()
  for (const seat of [...zone.seats].sort((a, b) => a.rowLabel.localeCompare(b.rowLabel) || a.seatNumber - b.seatNumber)) {
    rows.set(seat.rowLabel, [...(rows.get(seat.rowLabel) ?? []), String(seat.seatNumber)])
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">
          {zone.name} <span className="text-slate-500">({zone.code})</span>
        </h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {zone.kind === 'SEATED' ? `Khu ngồi · ${zone.seats.length} ghế` : `Khu đứng · ${zone.capacity} chỗ`}
        </span>
      </div>
      {zone.kind === 'SEATED' && (
        <>
          {rows.size === 0 && (
            <p className="mt-2 text-sm text-amber-700">Khu này chưa có ghế nào: nhập hàng ghế (ví dụ A-E), số ghế mỗi hàng, rồi bấm "Sinh ghế".</p>
          )}
          {rows.size > 0 && (
            <div className="mt-3 space-y-1 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">
              {[...rows.entries()].map(([label, numbers]) => (
                <div key={label} className="flex items-center gap-1 whitespace-nowrap">
                  <span className="w-8 shrink-0 font-semibold text-slate-500">{label}</span>
                  {numbers.map((n) => (
                    <span key={n} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface text-[10px] text-slate-600 ring-1 ring-slate-200">
                      {n}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          <AddRows zoneId={zone.id} onCreated={onChanged} />
        </>
      )}
    </Card>
  )
}

function AddRows({ zoneId, onCreated }: { zoneId: string; onCreated: () => void }) {
  const [labels, setLabels] = useState('')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('10')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const rowLabels = parseRowLabels(labels)
    const [start, end] = [Number(from), Number(to)]
    if (!rowLabels) return setError('Hàng ghế không hợp lệ. Ví dụ: "A-E" hoặc "A, B, F".')
    if (!(start >= 1 && end >= start && end <= MAX_SEAT_NUMBER)) return setError(`Số ghế từ 1 tới ${MAX_SEAT_NUMBER}, "đến" ≥ "từ".`)
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const { created } = await createSeats(
        zoneId,
        rowLabels.map((rowLabel) => ({ rowLabel, from: start, to: end })),
      )
      setInfo(`Đã tạo ${created} ghế.`)
      setLabels('')
      onCreated()
    } catch (err) {
      const apiError = toApiError(err)
      setError(venueCapacityMessage(apiError) ?? apiError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end" noValidate>
      <TextField label="Thêm hàng ghế" name="rows" placeholder="A-E" value={labels} onChange={(e) => setLabels(e.target.value)} className="col-span-2 sm:col-span-1" />
      <TextField label="Từ ghế số" name="from" type="number" min={1} value={from} onChange={(e) => setFrom(e.target.value)} />
      <TextField label="Đến ghế số" name="to" type="number" min={1} value={to} onChange={(e) => setTo(e.target.value)} />
      <Button type="submit" loading={busy} disabled={!labels.trim()} className="col-span-2 sm:col-span-1">
        Sinh ghế
      </Button>
      {error && <p className="col-span-2 text-sm text-red-600 sm:col-span-4">{error}</p>}
      {info && <p className="col-span-2 text-sm text-emerald-700 sm:col-span-4">{info}</p>}
    </form>
  )
}

function NewZone({ venueId, onCreated }: { venueId: string; onCreated: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', kind: 'SEATED' as ZoneKind, capacity: '' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      await createZone(venueId, {
        code: form.code.trim(),
        name: form.name.trim(),
        kind: form.kind,
        ...(form.kind === 'STANDING' ? { capacity: Number(form.capacity) } : {}),
      })
      setForm({ code: '', name: '', kind: form.kind, capacity: '' })
      onCreated()
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-dashed">
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_1fr_auto] sm:items-end" noValidate>
        <h3 className="font-semibold sm:col-span-5">Thêm khu</h3>
        {error && (
          <div className="sm:col-span-5">
            <Alert>{venueCapacityMessage(error) ?? error.message}</Alert>
          </div>
        )}
        <TextField label="Mã khu" name="code" placeholder="A" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={fieldErrors.code} />
        <TextField label="Tên khu" name="zoneName" placeholder="Khu A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fieldErrors.name} />
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Loại</span>
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as ZoneKind })}
            className="block w-full rounded-lg border border-slate-300 bg-surface px-3 py-2.5"
          >
            <option value="SEATED">Khu ngồi (có ghế)</option>
            <option value="STANDING">Khu đứng</option>
          </select>
        </label>
        <NumberField
          label="Sức chứa"
          name="zoneCapacity"
          disabled={form.kind === 'SEATED'}
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          error={fieldErrors.capacity}
        />
        <Button type="submit" loading={busy} disabled={!form.code || !form.name || (form.kind === 'STANDING' && !form.capacity)}>
          Thêm
        </Button>
      </form>
    </Card>
  )
}

/** "Các khu: 980 chỗ (80 ghế + 900 đứng) / sức chứa 1.000 · còn thêm được 20": the venue capacity is the ceiling. */
function PlacesLine({ capacity, zones }: { capacity: number | null; zones: LayoutZone[] }) {
  const { seats, standing, total } = zonePlaces(zones)
  const n = (value: number) => value.toLocaleString('vi-VN')
  return (
    <p className={`rounded-lg px-3 py-2 text-sm ${capacity && total > capacity ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-700'}`} data-testid="venue-places">
      Các khu: <strong>{n(total)}</strong> chỗ ({n(seats)} ghế + {n(standing)} đứng)
      {capacity ? (
        <>
          {' '}
          / sức chứa {n(capacity)} · còn thêm được <strong>{n(Math.max(0, capacity - total))}</strong>
        </>
      ) : (
        ' · địa điểm chưa có sức chứa (nên nhập để giới hạn số chỗ)'
      )}
    </p>
  )
}

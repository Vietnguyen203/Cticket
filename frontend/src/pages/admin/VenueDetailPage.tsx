import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import {
  createSeats,
  createZone,
  getVenue,
  getVenueLayout,
  updateVenue,
  type LayoutZone,
  type VenueRecord,
  type ZoneKind,
} from '../../api/admin'
import { ApiError, toApiError } from '../../api/errors'
import { PageHeader, StatusBadge } from '../../admin/components'
import { parseRowLabels } from '../../admin/rowLabels'
import { Alert, Button, Card, FullPageSpinner, TextField } from '../../components/ui'
import { useAsync } from '../../utils/useAsync'

const MAX_SEAT_NUMBER = 999

export function VenueDetailPage() {
  const { id = '' } = useParams()
  const venue = useAsync(() => getVenue(id), `venue:${id}`)
  const layout = useAsync(() => getVenueLayout(id), `layout:${id}`)

  if (venue.error) return <Alert>{venue.error.message}</Alert>
  if (!venue.data) return <FullPageSpinner />

  return (
    <>
      <PageHeader
        title={venue.data.name}
        subtitle={
          <Link to="/admin/venues" className="text-brand-700 hover:underline">
            ← Danh sách địa điểm
          </Link>
        }
      />
      <div className="space-y-4">
        <VenueInfo key={venue.data.id + venue.data.status} venue={venue.data} onSaved={venue.reload} />
        <section>
          <h2 className="mb-3 text-lg font-semibold">Khu và ghế</h2>
          {layout.error && <Alert>{layout.error.message}</Alert>}
          <div className="space-y-4">
            {layout.data?.zones.map((zone) => <ZoneCard key={zone.id} zone={zone} onChanged={layout.reload} />)}
            {layout.data?.zones.length === 0 && <p className="text-sm text-slate-500">Chưa có khu nào. Thêm khu ngồi hoặc khu đứng bên dưới.</p>}
            <NewZone venueId={id} onCreated={layout.reload} />
          </div>
        </section>
      </div>
    </>
  )
}

function VenueInfo({ venue, onSaved }: { venue: VenueRecord; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: venue.name,
    addressLine: venue.addressLine,
    city: venue.city,
    capacity: venue.capacity ? String(venue.capacity) : '',
  })
  const [error, setError] = useState<ApiError | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const changes = {
    ...(form.name.trim() !== venue.name ? { name: form.name.trim() } : {}),
    ...(form.addressLine.trim() !== venue.addressLine ? { addressLine: form.addressLine.trim() } : {}),
    ...(form.city.trim() !== venue.city ? { city: form.city.trim() } : {}),
    ...(form.capacity !== (venue.capacity ? String(venue.capacity) : '') ? { capacity: form.capacity ? Number(form.capacity) : null } : {}),
  }

  async function save(body: Parameters<typeof updateVenue>[1]) {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await updateVenue(venue.id, body)
      setSaved(true)
      onSaved()
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(changes)
        }}
        className="grid gap-3 sm:grid-cols-2"
        noValidate
      >
        <div className="flex items-center justify-between sm:col-span-2">
          <h2 className="font-semibold">Thông tin</h2>
          <StatusBadge status={venue.status} />
        </div>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error.message}</Alert>
          </div>
        )}
        {saved && Object.keys(changes).length === 0 && (
          <div className="sm:col-span-2">
            <Alert tone="success">Đã lưu.</Alert>
          </div>
        )}
        <TextField label="Tên" name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextField label="Thành phố" name="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <TextField
          label="Địa chỉ"
          name="addressLine"
          value={form.addressLine}
          onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
          className="sm:col-span-2"
        />
        <TextField label="Sức chứa" name="capacity" type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
        <div className="flex flex-wrap items-end justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void save({ status: venue.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
          >
            {venue.status === 'ACTIVE' ? 'Ngừng dùng' : 'Dùng lại'}
          </Button>
          <Button type="submit" loading={busy} disabled={Object.keys(changes).length === 0}>
            Lưu thay đổi
          </Button>
        </div>
      </form>
    </Card>
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
          {zone.name} <span className="text-slate-400">({zone.code})</span>
        </h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {zone.kind === 'SEATED' ? `Khu ngồi · ${zone.seats.length} ghế` : `Khu đứng · ${zone.capacity} chỗ`}
        </span>
      </div>
      {zone.kind === 'SEATED' && (
        <>
          {rows.size > 0 && (
            <div className="mt-3 space-y-1 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">
              {[...rows.entries()].map(([label, numbers]) => (
                <div key={label} className="flex items-center gap-1 whitespace-nowrap">
                  <span className="w-8 shrink-0 font-semibold text-slate-500">{label}</span>
                  {numbers.map((n) => (
                    <span key={n} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white text-[10px] text-slate-600 ring-1 ring-slate-200">
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
      setError(toApiError(err).message)
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
            <Alert>{error.message}</Alert>
          </div>
        )}
        <TextField label="Mã khu" name="code" placeholder="A" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={fieldErrors.code} />
        <TextField label="Tên khu" name="zoneName" placeholder="Khu A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fieldErrors.name} />
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Loại</span>
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as ZoneKind })}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
          >
            <option value="SEATED">Khu ngồi (có ghế)</option>
            <option value="STANDING">Khu đứng</option>
          </select>
        </label>
        <TextField
          label="Sức chứa"
          name="zoneCapacity"
          type="number"
          min={1}
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

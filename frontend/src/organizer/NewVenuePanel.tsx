import { useState } from 'react'
import { createVenue, type LayoutZone, type VenueRecord } from '../api/admin'
import { ApiError, toApiError } from '../api/errors'
import { VenueZonesEditor } from '../admin/VenueZonesEditor'
import { Alert, Button, TextField } from '../components/ui'
import { venueUsable } from './setup'

/**
 * A venue the organizer enters right in the schedule form. It is PENDING:
 * usable by their own draft events, approved together with the event.
 * Step 1: name and address. Step 2: zones and seats, then use it: only once
 * it can sell something (seats generated, or a standing zone), or the
 * schedule would be stuck with ticket types that can never get seats.
 */
export function NewVenuePanel({ onReady, onCancel }: { onReady: (venue: VenueRecord) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: '', addressLine: '', city: '' })
  const [venue, setVenue] = useState<VenueRecord | null>(null)
  const [zones, setZones] = useState<LayoutZone[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      setVenue(await createVenue({ name: form.name.trim(), addressLine: form.addressLine.trim(), city: form.city.trim() }))
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-brand-100 bg-brand-50/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">{venue ? `Địa điểm mới: ${venue.name}` : 'Địa điểm mới'}</h4>
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:underline">
          Thôi
        </button>
      </div>
      <p className="text-xs text-slate-600">Địa điểm mới ở trạng thái chờ duyệt: chỉ bạn dùng được, quản trị viên duyệt cùng lúc duyệt sự kiện.</p>
      {!venue ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {error && (
            <div className="sm:col-span-2">
              <Alert>{error.message}</Alert>
            </div>
          )}
          <TextField label="Tên địa điểm" name="venueName" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fieldErrors.name} />
          <TextField label="Thành phố" name="venueCity" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} error={fieldErrors.city} />
          <TextField
            label="Địa chỉ"
            name="venueAddress"
            value={form.addressLine}
            onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
            error={fieldErrors.addressLine}
            className="sm:col-span-2"
          />
          <div className="sm:col-span-2">
            <Button type="button" loading={busy} disabled={!form.name.trim() || !form.city.trim() || !form.addressLine.trim()} onClick={submit}>
              Tạo địa điểm, rồi thêm khu và ghế
            </Button>
          </div>
        </div>
      ) : (
        <>
          <VenueZonesEditor venueId={venue.id} onLayout={setZones} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!venueUsable(zones)} onClick={() => onReady(venue)}>
              Xong, dùng địa điểm này
            </Button>
            {!venueUsable(zones) && (
              <span className="text-sm text-amber-700">Thêm ít nhất một khu đứng, hoặc một khu ngồi rồi bấm "Sinh ghế".</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

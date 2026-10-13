import { useState, type FormEvent } from 'react'
import { listVenues } from '../api/admin'
import { ApiError, toApiError } from '../api/errors'
import { createSchedule } from '../api/organizer'
import { DateTimeField } from '../components/DateTimeField'
import { NewVenuePanel } from './NewVenuePanel'
import { Alert, Button, Card } from '../components/ui'
import { useAsync } from '../utils/useAsync'
import { fromVnInput } from '../utils/vnTime'

const NEW_VENUE = '__new__'

/** Add a show: venue, start / end, optional sales window (default: on sale now until the show starts). */
export function NewScheduleForm({ eventId, onCreated }: { eventId: string; onCreated: () => void }) {
  const venues = useAsync(() => listVenues({ pageSize: 50 }), 'active-venues')
  const [form, setForm] = useState({ venueId: '', startAt: '', endAt: '', salesStartAt: '', salesEndAt: '' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [round, setRound] = useState(0) // remounts the time fields to clear them
  const [newVenue, setNewVenue] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const startAt = fromVnInput(form.startAt)
    const endAt = fromVnInput(form.endAt)
    if (!startAt || !endAt) return setFieldErrors({ startAt: 'Nhập giờ bắt đầu và kết thúc.' })
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      await createSchedule(eventId, {
        venueId: form.venueId,
        startAt,
        endAt,
        ...(fromVnInput(form.salesStartAt) ? { salesStartAt: fromVnInput(form.salesStartAt) } : {}),
        ...(fromVnInput(form.salesEndAt) ? { salesEndAt: fromVnInput(form.salesEndAt) } : {}),
      })
      setForm({ ...form, startAt: '', endAt: '', salesStartAt: '', salesEndAt: '' })
      setRound((r) => r + 1)
      onCreated()
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })
  const time = (key: 'startAt' | 'endAt' | 'salesStartAt' | 'salesEndAt', label: string) => (
    <DateTimeField key={`${key}:${round}`} label={label} name={key} value={form[key]} onChange={(value) => setForm((f) => ({ ...f, [key]: value }))} error={fieldErrors[key]} />
  )

  return (
    <Card className="border-dashed">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
        <h3 className="font-semibold sm:col-span-2">Thêm suất diễn</h3>
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error.message}</Alert>
          </div>
        )}
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-slate-700">Địa điểm</span>
          <select
            value={newVenue ? NEW_VENUE : form.venueId}
            onChange={(e) => {
              setNewVenue(e.target.value === NEW_VENUE)
              if (e.target.value !== NEW_VENUE) set('venueId')(e)
            }}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5"
          >
            <option value="">Chọn địa điểm…</option>
            {venues.data?.venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name} — {venue.city}
                {venue.status === 'PENDING' ? ' (chờ duyệt)' : ''}
              </option>
            ))}
            <option value={NEW_VENUE}>+ Nhập địa điểm mới…</option>
          </select>
        </label>
        {time('startAt', 'Bắt đầu (giờ VN)')}
        {time('endAt', 'Kết thúc (giờ VN)')}
        {time('salesStartAt', 'Mở bán (để trống: ngay bây giờ)')}
        {time('salesEndAt', 'Đóng bán (để trống: lúc bắt đầu)')}
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy} disabled={newVenue || !form.venueId || !form.startAt || !form.endAt}>
            Thêm suất
          </Button>
        </div>
      </form>
      {newVenue && (
        <div className="mt-4">
          <NewVenuePanel
            onCancel={() => setNewVenue(false)}
            onReady={(venue) => {
              setNewVenue(false)
              setForm((f) => ({ ...f, venueId: venue.id }))
              venues.reload()
            }}
          />
        </div>
      )}
    </Card>
  )
}

import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { getVenue, updateVenue, type VenueRecord } from '../../api/admin'
import { ApiError, toApiError } from '../../api/errors'
import { PageHeader, StatusBadge } from '../../admin/components'
import { venueCapacityMessage } from '../../admin/venueCapacity'
import { VenueZonesEditor } from '../../admin/VenueZonesEditor'
import { Alert, Button, Card, FullPageSpinner, TextField } from '../../components/ui'
import { useAsync } from '../../utils/useAsync'

export function VenueDetailPage() {
  const { id = '' } = useParams()
  const venue = useAsync(() => getVenue(id), `venue:${id}`)

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
          <VenueZonesEditor venueId={id} />
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
        {venue.status === 'PENDING' && (
          <div className="sm:col-span-2">
            <Alert tone="warning">
              Địa điểm do ban tổ chức đề xuất. Duyệt sự kiện dùng địa điểm này sẽ duyệt luôn địa điểm; từ chối thì sự kiện đó không duyệt được cho tới khi đổi địa điểm.
            </Alert>
          </div>
        )}
        {error && (
          <div className="sm:col-span-2">
            <Alert>{venueCapacityMessage(error) ?? error.message}</Alert>
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
          {venue.status === 'PENDING' ? (
            <>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void save({ status: 'INACTIVE' })}>
                Từ chối
              </Button>
              <Button type="button" disabled={busy} onClick={() => void save({ status: 'ACTIVE' })}>
                Duyệt địa điểm
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void save({ status: venue.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
            >
              {venue.status === 'ACTIVE' ? 'Ngừng dùng' : 'Dùng lại'}
            </Button>
          )}
          <Button type="submit" loading={busy} disabled={Object.keys(changes).length === 0}>
            Lưu thay đổi
          </Button>
        </div>
      </form>
    </Card>
  )
}


import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { createVenue, listVenues, type VenueStatus } from '../../api/admin'
import { ApiError, toApiError } from '../../api/errors'
import { EmptyRow, PageHeader, Pagination, StatusBadge, TableCard, Tabs } from '../../admin/components'
import { Alert, Button, Card, TextField } from '../../components/ui'
import { useAsync } from '../../utils/useAsync'

const EMPTY = { name: '', addressLine: '', city: '', capacity: '' }

export function VenuesPage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<VenueStatus | 'ALL'>('ACTIVE')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const list = useAsync(
    () =>
      listVenues({
        q: search || undefined,
        ...(status === 'ALL' ? { includeInactive: true } : { status }),
        page,
        pageSize: 20,
      }),
    `${search}:${status}:${page}`,
  )

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const venue = await createVenue({
        name: form.name.trim(),
        addressLine: form.addressLine.trim(),
        city: form.city.trim(),
        ...(form.capacity ? { capacity: Number(form.capacity) } : {}),
      })
      navigate(`/admin/venues/${venue.id}`)
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  const set = (field: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [field]: e.target.value })

  return (
    <>
      <PageHeader
        title="Địa điểm"
        subtitle="Nhà hát, sân vận động… với các khu ngồi / khu đứng và sơ đồ ghế."
        actions={!creating && <Button onClick={() => setCreating(true)}>Thêm địa điểm</Button>}
      />

      {creating && (
        <Card className="mb-4">
          <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2" noValidate>
            {error && (
              <div className="sm:col-span-2">
                <Alert>{error.message}</Alert>
              </div>
            )}
            <TextField label="Tên địa điểm" name="name" value={form.name} onChange={set('name')} error={fieldErrors.name} />
            <TextField label="Thành phố" name="city" value={form.city} onChange={set('city')} error={fieldErrors.city} />
            <TextField
              label="Địa chỉ"
              name="addressLine"
              value={form.addressLine}
              onChange={set('addressLine')}
              error={fieldErrors.addressLine}
              className="sm:col-span-2"
            />
            <TextField label="Sức chứa (không bắt buộc)" name="capacity" type="number" min={1} value={form.capacity} onChange={set('capacity')} error={fieldErrors.capacity} />
            <div className="flex items-end justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                Thôi
              </Button>
              <Button type="submit" loading={busy} disabled={!form.name || !form.city || !form.addressLine}>
                Tạo và thêm khu / ghế
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Tabs
        value={status}
        onChange={(value) => {
          setStatus(value)
          setPage(1)
        }}
        options={[
          ['ACTIVE', 'Đang dùng'],
          ['PENDING', 'Chờ duyệt (ban tổ chức đề xuất)'],
          ['INACTIVE', 'Ngừng dùng'],
          ['ALL', 'Tất cả'],
        ]}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(q.trim())
          setPage(1)
        }}
        className="mb-4 flex flex-wrap items-center gap-3"
        role="search"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo tên"
          aria-label="Tìm địa điểm"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2"
        />
        <Button type="submit" variant="secondary">
          Tìm
        </Button>
      </form>

      {list.error && <Alert>{list.error.message}</Alert>}
      <TableCard>
        <thead>
          <tr>
            <th>Tên</th>
            <th>Địa chỉ</th>
            <th>Sức chứa</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.venues.map((venue) => (
            <tr key={venue.id}>
              <td>
                <Link to={`/admin/venues/${venue.id}`} className="font-medium text-brand-700 hover:underline">
                  {venue.name}
                </Link>
              </td>
              <td className="text-slate-600">
                {venue.addressLine}, {venue.city}
              </td>
              <td className="text-slate-600">{venue.capacity ?? '—'}</td>
              <td>
                <StatusBadge status={venue.status} />
              </td>
            </tr>
          ))}
          {list.data?.venues.length === 0 && <EmptyRow colSpan={4}>Không có địa điểm nào.</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={setPage} />
    </>
  )
}

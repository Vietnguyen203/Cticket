import { useState } from 'react'
import { Link } from 'react-router'
import { listEventsByStatus, type EventStatus } from '../../api/admin'
import { EmptyRow, PageHeader, Pagination, StatusBadge, TableCard, Tabs } from '../../admin/components'
import { Alert, Button } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

export function EventsReviewPage() {
  const [status, setStatus] = useState<EventStatus>('PENDING_APPROVAL')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const list = useAsync(
    () => listEventsByStatus({ status, q: search || undefined, page, pageSize: 20 }),
    `${status}:${search}:${page}`,
  )

  return (
    <>
      <PageHeader title="Duyệt sự kiện" subtitle="Sự kiện ban tổ chức gửi lên; duyệt thì vé được mở bán theo lịch của từng suất." />
      <Tabs
        value={status}
        onChange={(value) => {
          setStatus(value)
          setPage(1)
        }}
        options={[
          ['PENDING_APPROVAL', 'Chờ duyệt'],
          ['PUBLISHED', 'Đang bán'],
          ['DRAFT', 'Nháp'],
          ['CANCELLED', 'Đã hủy'],
          ['FINISHED', 'Đã diễn'],
        ]}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(q.trim())
          setPage(1)
        }}
        className="mb-4 flex gap-2"
        role="search"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo tên sự kiện"
          aria-label="Tìm sự kiện"
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
            <th>Sự kiện</th>
            <th>Ban tổ chức</th>
            <th>Suất gần nhất</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.events.map((event) => (
            <tr key={event.id}>
              <td>
                <Link to={`/admin/events/${event.id}`} className="font-medium text-brand-700 hover:underline">
                  {event.title}
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">{event.categories.map((c) => c.name).join(', ')}</p>
              </td>
              <td className="text-slate-600">{event.organizer.name}</td>
              <td className="whitespace-nowrap text-slate-600">{event.nextStartAt ? formatDateTime(event.nextStartAt) : '—'}</td>
              <td>
                <StatusBadge status={event.status} />
              </td>
            </tr>
          ))}
          {list.data?.events.length === 0 && <EmptyRow colSpan={4}>Không có sự kiện nào.</EmptyRow>}
          {!list.data && list.loading && <EmptyRow colSpan={4}>Đang tải…</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={setPage} />
    </>
  )
}

import { useState } from 'react'
import { Link } from 'react-router'
import { listMyEvents } from '../../api/organizer'
import { EmptyRow, PageHeader, Pagination, StatusBadge, TableCard, Tabs } from '../../admin/components'
import { Alert } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

type Filter = 'ALL' | 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'CANCELLED' | 'FINISHED'

export function MyEventsPage() {
  const [status, setStatus] = useState<Filter>('ALL')
  const [page, setPage] = useState(1)
  const list = useAsync(
    () => listMyEvents({ status: status === 'ALL' ? undefined : status, page, pageSize: 20 }),
    `${status}:${page}`,
  )
  const noProfile = list.error?.code === 'ORGANIZER_PROFILE_REQUIRED'

  return (
    <>
      <PageHeader
        title="Sự kiện của tôi"
        actions={
          <Link to="/organizer/events/new" className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800">
            Tạo sự kiện
          </Link>
        }
      />
      <Tabs
        value={status}
        onChange={(value) => {
          setStatus(value)
          setPage(1)
        }}
        options={[
          ['ALL', 'Tất cả'],
          ['DRAFT', 'Nháp'],
          ['PENDING_APPROVAL', 'Chờ duyệt'],
          ['PUBLISHED', 'Đang bán'],
          ['FINISHED', 'Đã diễn'],
          ['CANCELLED', 'Đã hủy'],
        ]}
      />
      {noProfile ? (
        <Alert tone="info">
          Bạn cần hồ sơ nhà tổ chức đã được duyệt.{' '}
          <Link to="/organizer/apply" className="font-semibold underline">
            Đăng ký / xem trạng thái
          </Link>
        </Alert>
      ) : (
        list.error && <Alert>{list.error.message}</Alert>
      )}
      <TableCard>
        <thead>
          <tr>
            <th>Sự kiện</th>
            <th>Suất gần nhất</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.events.map((event) => (
            <tr key={event.id}>
              <td>
                <Link to={`/organizer/events/${event.id}`} className="font-medium text-brand-700 hover:underline">
                  {event.title}
                </Link>
              </td>
              <td className="whitespace-nowrap text-slate-600">{event.nextStartAt ? formatDateTime(event.nextStartAt) : '—'}</td>
              <td>
                <StatusBadge status={event.status} />
              </td>
            </tr>
          ))}
          {list.data?.events.length === 0 && <EmptyRow colSpan={3}>Chưa có sự kiện nào.</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={setPage} />
    </>
  )
}

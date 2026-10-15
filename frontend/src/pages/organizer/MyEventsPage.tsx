import { useState } from 'react'
import { Link } from 'react-router'
import { listMyEvents } from '../../api/organizer'
import { getMyEventsSales, type MyEventLine } from '../../api/reports'
import { EmptyRow, PageHeader, Pagination, StatusBadge, TableCard, Tabs } from '../../admin/components'
import { Alert } from '../../components/ui'
import { Stat } from '../../reports/parts'
import { formatDateTime, formatVnd } from '../../utils/format'
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
  // REP-01b: sold / revenue per event, matched to the rows by id.
  const sales = useAsync(getMyEventsSales, 'my-events-sales')
  const salesOf = new Map(sales.data?.events.map((line) => [line.id, line]))
  const onSale = sales.data?.events.filter((line) => line.status === 'PUBLISHED').length

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
      {sales.data && sales.data.events.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Doanh thu" value={formatVnd(sales.data.totals.revenue)} note={`${sales.data.totals.orders} đơn`} />
          <Stat label="Vé đã bán" value={sales.data.totals.tickets} />
          <Stat label="Sự kiện đang bán" value={onSale ?? 0} />
          <Stat
            label="Hoàn tiền"
            value={formatVnd(sales.data.totals.refunds.amount)}
            note={`${sales.data.totals.refunds.orders} đơn${
              sales.data.totals.cancellationFees > 0 ? ` · phí hủy giữ lại ${formatVnd(sales.data.totals.cancellationFees)}` : ''
            }`}
            tone={sales.data.totals.refunds.orders > 0 ? 'red' : undefined}
          />
        </div>
      )}
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
            <th>Đã bán / chỗ</th>
            <th>Doanh thu</th>
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
              <SalesCells line={salesOf.get(event.id)} eventId={event.id} />
              <td>
                <StatusBadge status={event.status} />
              </td>
            </tr>
          ))}
          {list.data?.events.length === 0 && <EmptyRow colSpan={5}>Chưa có sự kiện nào.</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={setPage} />
    </>
  )
}

function SalesCells({ line, eventId }: { line: MyEventLine | undefined; eventId: string }) {
  if (!line || line.capacity === 0) {
    return (
      <>
        <td className="text-slate-400">—</td>
        <td className="text-slate-400">—</td>
      </>
    )
  }
  return (
    <>
      <td className="whitespace-nowrap tabular-nums">
        {line.tickets} / {line.capacity - line.blocked}
      </td>
      <td className="whitespace-nowrap">
        <Link to={`/organizer/events/${eventId}?tab=sales`} className="hover:underline">
          {formatVnd(line.revenue)}
        </Link>
      </td>
    </>
  )
}

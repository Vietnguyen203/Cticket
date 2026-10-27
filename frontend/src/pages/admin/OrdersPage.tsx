import { useState } from 'react'
import { Link } from 'react-router'
import { listAllOrders } from '../../api/admin'
import { EmptyRow, PageHeader, Pagination, TableCard, Tabs } from '../../admin/components'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { Alert, Button } from '../../components/ui'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

type Filter = 'ALL' | 'HELD' | 'PAYMENT_PENDING' | 'PAID' | 'REFUNDED' | 'CANCELLED' | 'EXPIRED'

/** ORD-05: every order, by status, found by order code or buyer email. */
export function OrdersPage() {
  const [status, setStatus] = useState<Filter>('ALL')
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const list = useAsync(
    () => listAllOrders({ q: q || undefined, status: status === 'ALL' ? undefined : status, page, pageSize: 20 }),
    `${status}:${q}:${page}`,
  )

  return (
    <>
      <PageHeader title="Đơn hàng" subtitle="Tra cứu đơn, xem thanh toán và vé; hoàn tiền, cấp lại mã QR." />
      <Tabs
        value={status}
        onChange={(value) => {
          setStatus(value)
          setPage(1)
        }}
        options={[
          ['ALL', 'Tất cả'],
          ['PAID', 'Đã thanh toán'],
          ['HELD', 'Đang giữ chỗ'],
          ['PAYMENT_PENDING', 'Chờ thanh toán'],
          ['REFUNDED', 'Đã hoàn tiền'],
          ['CANCELLED', 'Đã hủy'],
          ['EXPIRED', 'Hết hạn'],
        ]}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setQ(draft.trim())
          setPage(1)
        }}
        role="search"
        className="mb-4 flex gap-2"
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Mã đơn hoặc email người mua" aria-label="Tìm đơn" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-surface px-3 py-2" />
        <Button type="submit" variant="secondary">
          Tìm
        </Button>
      </form>
      {list.error && <Alert>{list.error.message}</Alert>}
      <TableCard>
        <thead>
          <tr>
            <th>Mã đơn</th>
            <th>Người mua</th>
            <th>Sự kiện</th>
            <th>Tổng tiền</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.orders.map((order) => (
            <tr key={order.id}>
              <td>
                <Link to={`/admin/orders/${order.id}`} className="font-mono font-medium text-brand-700 hover:underline">
                  {order.orderCode}
                </Link>
                <p className="text-xs text-slate-500">{formatDateTime(order.createdAt)}</p>
              </td>
              <td className="text-slate-600">{order.buyerEmail}</td>
              <td>
                <p>{order.event.title}</p>
                <p className="text-xs text-slate-500">{formatDateTime(order.schedule.startAt)}</p>
              </td>
              <td className="whitespace-nowrap">{formatVnd(order.totalAmount)}</td>
              <td>
                <OrderStatusBadge status={order.status} />
              </td>
            </tr>
          ))}
          {list.data?.orders.length === 0 && <EmptyRow colSpan={5}>Không có đơn nào.</EmptyRow>}
        </tbody>
      </TableCard>
      <Pagination meta={list.data?.meta} onPage={setPage} />
    </>
  )
}

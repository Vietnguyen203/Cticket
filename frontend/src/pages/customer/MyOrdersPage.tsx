import { useState } from 'react'
import { Link } from 'react-router'
import { listMyOrders } from '../../api/orders'
import { Pagination } from '../../admin/components'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { Alert, Card, FullPageSpinner } from '../../components/ui'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/** APP-C05: my orders, newest first; open ones lead back to checkout. */
export function MyOrdersPage() {
  const [page, setPage] = useState(1)
  const list = useAsync(() => listMyOrders({ page, pageSize: 10 }), `my-orders:${page}`)

  if (list.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert>{list.error.message}</Alert>
      </div>
    )
  }
  if (!list.data) return <FullPageSpinner />

  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold">Đơn hàng của tôi</h1>
      {list.data.orders.length === 0 && (
        <Card className="text-center text-slate-500">
          Chưa có đơn nào.{' '}
          <Link to="/events" className="font-semibold text-brand-700 hover:underline">
            Xem sự kiện
          </Link>
        </Card>
      )}
      {list.data.orders.map((order) => (
        <Link key={order.id} to={`/orders/${order.id}`} className="block">
          <Card className="!p-4 transition hover:border-brand-600">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{order.event.title}</p>
                <p className="text-sm text-slate-600">
                  {formatDateTime(order.schedule.startAt)} · {order.schedule.venueName}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {order.orderCode} · {order.items.reduce((n, item) => n + item.quantity, 0)} vé · {formatVnd(order.totalAmount)}
                </p>
              </div>
              <OrderStatusBadge status={order.status} />
            </div>
          </Card>
        </Link>
      ))}
      <Pagination meta={list.data.meta} onPage={setPage} />
    </div>
  )
}

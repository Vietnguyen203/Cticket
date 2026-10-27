import { useState } from 'react'
import { Link } from 'react-router'
import { listMyOrders } from '../../api/orders'
import { Pagination } from '../../admin/components'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { DateBlock } from '../../components/DateBlock'
import { ChevronRightIcon, TicketIcon } from '../../components/icons'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui'
import { formatDateTime, formatVnd } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/** Orders that still lead somewhere (pay, tickets): shown in colour, the others greyed. */
const LIVE = ['HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'COMPLETED']

/** APP-C05: my orders, newest first; open ones lead back to checkout. */
export function MyOrdersPage() {
  const [page, setPage] = useState(1)
  const list = useAsync(() => listMyOrders({ page, pageSize: 10 }), `my-orders:${page}`)

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader title="Đơn hàng của tôi" subtitle="Đơn mới nhất ở trên. Đơn đang giữ chỗ có thể thanh toán tiếp." />
      {list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <div className="space-y-3" role="status" aria-label="Đang tải đơn hàng">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full !rounded-card" />
          ))}
        </div>
      ) : list.data.orders.length === 0 ? (
        <EmptyState
          icon={<TicketIcon />}
          title="Chưa có đơn nào"
          action={
            <Link to="/events" className="pressable inline-flex h-11 items-center rounded-control bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">
              Xem sự kiện
            </Link>
          }
        >
          Chọn một sự kiện, giữ chỗ và thanh toán, đơn sẽ hiện ở đây.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {list.data.orders.map((order) => (
            <Link
              key={order.id}
              to={`/orders/${order.id}`}
              className="group flex animate-fade-up items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card transition hover:-translate-y-px hover:border-slate-300 hover:shadow-raised"
            >
              <DateBlock iso={order.schedule.startAt} muted={!LIVE.includes(order.status)} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-semibold leading-snug text-ink group-hover:text-brand-700">{order.event.title}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {formatDateTime(order.schedule.startAt)} · {order.schedule.venueName}
                </p>
                <p className="mt-1.5 text-xs text-slate-500">
                  <span className="font-mono text-slate-700">{order.orderCode}</span> · {order.items.reduce((n, item) => n + item.quantity, 0)} vé ·{' '}
                  <span className="font-semibold text-ink">{formatVnd(order.totalAmount)}</span>
                </p>
                <div className="mt-2 sm:hidden">
                  <OrderStatusBadge status={order.status} />
                </div>
              </div>
              <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex">
                <OrderStatusBadge status={order.status} />
                <ChevronRightIcon size={18} className="text-slate-400 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
      <Pagination meta={list.data?.meta} onPage={setPage} />
    </div>
  )
}

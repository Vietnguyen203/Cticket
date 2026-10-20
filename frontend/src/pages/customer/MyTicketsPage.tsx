import { Link } from 'react-router'
import { listMyTickets, type MyTicket } from '../../api/tickets'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { DateBlock } from '../../components/DateBlock'
import { ChevronRightIcon, MapPinIcon, StarIcon, TicketIcon } from '../../components/icons'
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

const MAX_TICKETS = 50

/** APP-C05: my tickets — upcoming shows first, then the ones that are over. */
export function MyTicketsPage() {
  // Split at load time (not during render): upcoming = the show is not over yet.
  const list = useAsync(async () => {
    const { tickets } = await listMyTickets({ pageSize: MAX_TICKETS })
    const now = Date.now()
    return {
      tickets,
      upcoming: tickets.filter((t) => Date.parse(t.schedule.endAt) >= now),
      past: tickets.filter((t) => Date.parse(t.schedule.endAt) < now),
    }
  }, 'my-tickets')

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <PageHeader title="Vé của tôi" subtitle="Mở vé để xem mã QR khi vào cổng, hoặc tải bản PDF." />
      {list.error ? (
        <ErrorState message={list.error.message} onRetry={list.reload} />
      ) : !list.data ? (
        <div className="space-y-3" role="status" aria-label="Đang tải vé">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full !rounded-card" />
          ))}
        </div>
      ) : list.data.tickets.length === 0 ? (
        <EmptyState
          icon={<TicketIcon />}
          title="Bạn chưa có vé nào"
          action={
            <Link to="/events" className="inline-flex h-11 items-center rounded-control bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">
              Tìm sự kiện
            </Link>
          }
        >
          Vé bạn mua sẽ hiện ở đây, kèm mã QR để vào cổng.
        </EmptyState>
      ) : (
        <>
          <Section title="Sắp diễn" tickets={list.data.upcoming} />
          <Section title="Đã qua" tickets={list.data.past} past />
        </>
      )}
    </div>
  )
}

function Section({ title, tickets, past = false }: { title: string; tickets: MyTicket[]; past?: boolean }) {
  if (tickets.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title} <span className="font-normal">({tickets.length})</span>
      </h2>
      {tickets.map((ticket) => (
        <div key={ticket.id} className="space-y-1.5">
          <Link
            to={`/tickets/${ticket.id}`}
            className="group flex items-center gap-4 rounded-card border border-line bg-white p-4 shadow-card transition hover:border-slate-300 hover:shadow-raised"
          >
            <DateBlock iso={ticket.schedule.startAt} muted={past} />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 font-semibold leading-snug text-ink group-hover:text-brand-700">{ticket.event.title}</p>
              <p className="mt-1 flex items-start gap-1 text-sm text-slate-600">
                <MapPinIcon size={15} className="mt-0.5 shrink-0 text-slate-400" />
                <span>
                  {formatDateTime(ticket.schedule.startAt)} · {ticket.venue.name}
                </span>
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                <span className="font-mono text-slate-700">{ticket.code}</span> · {ticket.seatLabel ?? `${ticket.ticketTypeName} #${ticket.admissionNo}`}
              </p>
              <div className="mt-2 sm:hidden">
                <OrderStatusBadge status={ticket.status} />
              </div>
            </div>
            <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex">
              <OrderStatusBadge status={ticket.status} />
              <ChevronRightIcon size={18} className="text-slate-400" />
            </div>
          </Link>
          {/* Phase 19: went in → may review the event. */}
          {ticket.status === 'USED' && (
            <Link
              to={`/events/${ticket.event.id}#danh-gia`}
              className="ml-4 inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              <StarIcon size={16} className="text-amber-500" />
              Đánh giá sự kiện
            </Link>
          )}
        </div>
      ))}
    </section>
  )
}

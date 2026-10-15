import { Link } from 'react-router'
import { listMyTickets, type MyTicket } from '../../api/tickets'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { Alert, Card, FullPageSpinner } from '../../components/ui'
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
  if (list.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert>{list.error.message}</Alert>
      </div>
    )
  }
  if (!list.data) return <FullPageSpinner />

  const { upcoming, past } = list.data

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-10">
      <h1 className="text-2xl font-bold">Vé của tôi</h1>
      {list.data.tickets.length === 0 && (
        <Card className="text-center text-slate-500">
          Bạn chưa có vé nào.{' '}
          <Link to="/events" className="font-semibold text-brand-700 hover:underline">
            Tìm sự kiện
          </Link>
        </Card>
      )}
      <Section title="Sắp diễn" tickets={upcoming} />
      <Section title="Đã qua" tickets={past} />
    </div>
  )
}

function Section({ title, tickets }: { title: string; tickets: MyTicket[] }) {
  if (tickets.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="font-semibold text-slate-700">{title}</h2>
      {tickets.map((ticket) => (
        <div key={ticket.id} className="space-y-1">
          <Link to={`/tickets/${ticket.id}`} className="block">
            <Card className="flex items-center justify-between gap-3 !p-4 transition hover:border-brand-600">
              <div>
                <p className="font-semibold">{ticket.event.title}</p>
                <p className="text-sm text-slate-600">
                  {formatDateTime(ticket.schedule.startAt)} · {ticket.venue.name}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  <span className="font-mono">{ticket.code}</span> · {ticket.seatLabel ?? `${ticket.ticketTypeName} #${ticket.admissionNo}`}
                </p>
              </div>
              <OrderStatusBadge status={ticket.status} />
            </Card>
          </Link>
          {/* Phase 19: went in → may review the event. */}
          {ticket.status === 'USED' && (
            <Link to={`/events/${ticket.event.id}#danh-gia`} className="ml-4 inline-block text-sm font-semibold text-brand-700 hover:underline">
              ★ Đánh giá sự kiện
            </Link>
          )}
        </div>
      ))}
    </section>
  )
}

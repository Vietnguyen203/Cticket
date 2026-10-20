import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { downloadTicketPdf, getMyTicket, getTicketQrPng } from '../../api/tickets'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { CalendarIcon, ChevronLeftIcon, MapPinIcon } from '../../components/icons'
import { Alert, Button, FullPageSpinner } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/** TKT-02: the ticket and its QR code, to show at the gate. Drawn as a ticket stub. */
export function TicketPage() {
  const { id = '' } = useParams()
  const ticket = useAsync(() => getMyTicket(id), `ticket:${id}`)
  const qrToken = ticket.data?.qrToken ?? null
  // The PNG blob as an object URL (an <img> cannot send the Authorization header).
  const qr = useAsync(
    async () => (qrToken ? URL.createObjectURL(await getTicketQrPng(id)) : null),
    `qr:${id}:${qrToken}`,
  )
  const qrUrl = qr.data ?? null
  // Release the previous image when it changes or the page closes.
  useEffect(() => () => {
    if (qrUrl) URL.revokeObjectURL(qrUrl)
  }, [qrUrl])

  if (ticket.error) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert>{ticket.error.message}</Alert>
      </div>
    )
  }
  if (!ticket.data) return <FullPageSpinner />
  const t = ticket.data

  return (
    <div className="mx-auto max-w-sm space-y-4 px-4 py-6 sm:py-10">
      <Link to="/tickets" className="inline-flex items-center gap-1 rounded-control text-sm font-medium text-slate-600 hover:text-ink">
        <ChevronLeftIcon size={16} />
        Vé của tôi
      </Link>

      <article className="overflow-hidden rounded-panel bg-white shadow-raised ring-1 ring-line">
        <header className="space-y-2 bg-ink p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-300">Vé điện tử</p>
          <h1 className="text-xl font-bold leading-snug">{t.event.title}</h1>
          <p className="flex items-start gap-2 text-sm text-slate-300">
            <CalendarIcon size={16} className="mt-0.5 shrink-0 text-slate-400" />
            {formatDateTime(t.schedule.startAt)}
          </p>
          <p className="flex items-start gap-2 text-sm text-slate-300">
            <MapPinIcon size={16} className="mt-0.5 shrink-0 text-slate-400" />
            {t.venue.name}, {t.venue.city}
          </p>
        </header>

        {/* The perforation between the stub and the ticket. */}
        <div aria-hidden="true" className="relative h-4">
          <span className="absolute -left-2 top-0 h-4 w-4 rounded-full bg-canvas" />
          <span className="absolute -right-2 top-0 h-4 w-4 rounded-full bg-canvas" />
          <span className="absolute inset-x-4 top-1/2 border-t-2 border-dashed border-line" />
        </div>

        <div className="space-y-4 px-5 pb-6 pt-2 text-center">
          <div className="flex items-center justify-between gap-3 text-left">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Chỗ</p>
              <p className="font-semibold text-ink">{t.seatLabel ?? `${t.ticketTypeName} · vé đứng #${t.admissionNo}`}</p>
            </div>
            <OrderStatusBadge status={t.status} />
          </div>
          {t.qrToken ? (
            <>
              {qrUrl ? (
                <img src={qrUrl} alt={`Mã QR của vé ${t.code}`} className="mx-auto aspect-square w-64 max-w-full rounded-card ring-1 ring-line" />
              ) : (
                <div className="mx-auto aspect-square w-64 max-w-full animate-pulse rounded-card bg-slate-100" />
              )}
              <p className="font-mono text-lg font-semibold tracking-wider text-ink">{t.code}</p>
              {qrUrl && (
                <div className="flex gap-2">
                  <a
                    href={qrUrl}
                    download={`${t.code}.png`}
                    className="flex h-11 flex-1 items-center justify-center rounded-control border border-line bg-white text-sm font-semibold text-ink shadow-card hover:bg-slate-50"
                  >
                    Tải ảnh QR
                  </a>
                  {/* Phase 20: a printable ticket (valid ones only: a used ticket opens no gate). */}
                  {t.status === 'VALID' && (
                    <Button variant="secondary" className="flex-1" onClick={() => void downloadTicketPdf(t.id, t.code)}>
                      Tải vé PDF
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <Alert tone="warning">Vé không còn hiệu lực nên không có mã QR.</Alert>
              <p className="font-mono text-lg font-semibold tracking-wider text-slate-500">{t.code}</p>
            </>
          )}
          <p className="text-xs leading-relaxed text-slate-500">
            {t.status === 'USED' && t.usedAt ? `Đã vào cổng lúc ${formatDateTime(t.usedAt)}. ` : ''}
            Đưa mã QR cho nhân viên ở cổng. Không chia sẻ ảnh QR: ai có ảnh đều dùng được vé.
          </p>
        </div>
      </article>
    </div>
  )
}

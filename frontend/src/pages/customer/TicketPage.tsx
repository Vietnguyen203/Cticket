import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { downloadTicketPdf, getMyTicket, getTicketQrPng } from '../../api/tickets'
import { OrderStatusBadge } from '../../admin/OrderStatusBadge'
import { Alert, Card, FullPageSpinner } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

/** TKT-02: the ticket and its QR code, to show at the gate. */
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
    <div className="mx-auto max-w-sm space-y-4 px-4 py-6">
      <Link to="/tickets" className="text-sm text-brand-700 hover:underline">
        ← Vé của tôi
      </Link>
      <Card className="space-y-3 text-center">
        <p className="text-lg font-bold">{t.event.title}</p>
        <p className="text-sm text-slate-600">
          {formatDateTime(t.schedule.startAt)}
          <br />
          {t.venue.name}, {t.venue.city}
        </p>
        <p className="text-base font-semibold">{t.seatLabel ?? `${t.ticketTypeName} · vé đứng #${t.admissionNo}`}</p>
        <div className="flex justify-center">
          <OrderStatusBadge status={t.status} />
        </div>
        {t.qrToken ? (
          <>
            {qrUrl ? (
              <img src={qrUrl} alt={`Mã QR của vé ${t.code}`} className="mx-auto aspect-square w-64 max-w-full rounded-lg ring-1 ring-slate-200" />
            ) : (
              <div className="mx-auto aspect-square w-64 animate-pulse rounded-lg bg-slate-100" />
            )}
            {qrUrl && (
              <p className="flex justify-center gap-4 text-sm font-semibold">
                <a href={qrUrl} download={`${t.code}.png`} className="text-brand-700 hover:underline">
                  Tải ảnh QR
                </a>
                {/* Phase 20: a printable ticket (valid ones only: a used ticket opens no gate). */}
                {t.status === 'VALID' && (
                  <button type="button" onClick={() => void downloadTicketPdf(t.id, t.code)} className="text-brand-700 hover:underline">
                    Tải vé PDF
                  </button>
                )}
              </p>
            )}
          </>
        ) : (
          <Alert tone="warning">Vé không còn hiệu lực nên không có mã QR.</Alert>
        )}
        <p className="font-mono text-lg tracking-wider">{t.code}</p>
        <p className="text-xs text-slate-500">
          {t.status === 'USED' && t.usedAt ? `Đã vào cổng lúc ${formatDateTime(t.usedAt)}. ` : ''}
          Đưa mã QR cho nhân viên ở cổng. Không chia sẻ ảnh QR: ai có ảnh đều dùng được vé.
        </p>
      </Card>
    </div>
  )
}

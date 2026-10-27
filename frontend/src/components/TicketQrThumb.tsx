import { useEffect } from 'react'
import { getTicketQrPng } from '../api/tickets'
import { useAsync } from '../utils/useAsync'
import { Skeleton } from './ui'

/**
 * A ticket's QR code, small, on the paid order (the confirmation shows the
 * tickets at once). The image comes with the session, as on the ticket page;
 * the full-size code and its download stay on that page.
 */
export function TicketQrThumb({ ticketId }: { ticketId: string }) {
  const qr = useAsync(async () => URL.createObjectURL(await getTicketQrPng(ticketId)), `qr-thumb:${ticketId}`)
  const url = qr.data ?? null
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  if (qr.error) return null
  // White behind the code in both themes: scanners need the contrast. Decorative for
  // screen readers (alt=""): the link around it already says the ticket's code, seat
  // and "Xem QR", and only the ticket page's full-size code is named "Mã QR của vé …".
  return url ? (
    <img src={url} alt="" className="h-20 w-20 shrink-0 rounded-control bg-white p-1 ring-1 ring-line" />
  ) : (
    <Skeleton className="h-20 w-20 shrink-0" />
  )
}

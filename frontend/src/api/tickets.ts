import { api } from './client'
import type { PageMeta } from './types'

export interface MyTicket {
  id: string
  code: string
  seatLabel: string | null
  ticketTypeName: string
  admissionNo: number
  status: 'VALID' | 'USED' | 'CANCELLED' | 'REFUNDED'
  issuedAt: string
  usedAt: string | null
  orderId: string
  event: { id: string; title: string }
  schedule: { id: string; startAt: string; endAt: string; status: string }
  venue: { name: string; address: string; city: string }
  /** Detail only: the QR content (null when the ticket is no longer valid) */
  qrToken?: string | null
}

export async function listMyTickets(params: { status?: string; page?: number; pageSize?: number }) {
  const res = await api.get('/tickets', { params })
  return { tickets: res.data.data.tickets as MyTicket[], meta: res.data.meta as PageMeta }
}

export async function getMyTicket(id: string): Promise<MyTicket> {
  return (await api.get(`/tickets/${id}`)).data.data.ticket
}

/** The QR as a PNG blob (an <img> cannot send the Authorization header): show it with an object URL. */
export async function getTicketQrPng(id: string): Promise<Blob> {
  return (await api.get(`/tickets/${id}/qr.png`, { responseType: 'blob' })).data
}

/** Phase 20: save a PDF the API sends (fetched with the session, then handed to the browser). */
async function savePdf(url: string, fallbackName: string) {
  const res = await api.get(url, { responseType: 'blob' })
  const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? fallbackName
  const href = URL.createObjectURL(res.data as Blob)
  const link = Object.assign(document.createElement('a'), { href, download: name })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

/** The valid tickets of an order, one page each. */
export function downloadOrderTicketsPdf(orderId: string, orderCode: string) {
  return savePdf(`/orders/${orderId}/tickets.pdf`, `Ve-${orderCode}.pdf`)
}

/** One valid ticket. */
export function downloadTicketPdf(ticketId: string, code: string) {
  return savePdf(`/tickets/${ticketId}/ticket.pdf`, `Ve-${code}.pdf`)
}

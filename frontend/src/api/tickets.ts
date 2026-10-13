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

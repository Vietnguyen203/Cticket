import { api } from './client'

/** Phase 18.4: the waiting list of a sold-out ticket type. */
export interface WaitlistEntry {
  id: string
  /** WAITING → OFFERED (places kept until offerExpiresAt) → BOOKED / EXPIRED; CANCELLED, CLOSED */
  status: 'WAITING' | 'OFFERED' | 'BOOKED' | 'EXPIRED' | 'CANCELLED' | 'CLOSED'
  quantity: number
  /** Place among the people still waiting (WAITING only) */
  position: number | null
  offeredAt: string | null
  offerExpiresAt: string | null
  createdAt: string
  ticketType: { id: string; name: string }
  schedule: { id: string; startAt: string; venueName: string }
  event: { title: string; slug: string }
}

export async function joinWaitlist(scheduleId: string, ticketTypeId: string, quantity: number): Promise<WaitlistEntry> {
  return (await api.post(`/schedules/${scheduleId}/waitlist`, { ticketTypeId, quantity })).data.data.entry
}

export async function listMyWaitlist(): Promise<WaitlistEntry[]> {
  return (await api.get('/waitlist')).data.data.entries
}

export async function leaveWaitlist(id: string): Promise<void> {
  await api.delete(`/waitlist/${id}`)
}

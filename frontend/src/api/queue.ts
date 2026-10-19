import { api } from './client'

/** Phase 21: my place in the purchase queue of an event. */
export interface QueueView {
  /** false: the event has no queue (or it is down): everyone may book */
  enabled: boolean
  /** ACTIVE: my turn to book; WAITING: in line; NONE: not in the queue */
  state: 'ACTIVE' | 'WAITING' | 'NONE'
  turnEndsAt: string | null
  /** 1 = next in line (WAITING only) */
  place: number | null
  ahead: number | null
  estimatedWaitSeconds: number | null
  capacity?: number
  sessionMinutes?: number
}

/** The organizer's / admin's view: people buying and waiting now. */
export interface QueueStats {
  enabled: boolean
  capacity: number
  sessionMinutes: number
  active: number | null
  waiting: number | null
}

export async function joinQueue(eventId: string): Promise<QueueView> {
  return (await api.post(`/events/${eventId}/queue`)).data.data.queue
}

export async function getQueueStatus(eventId: string): Promise<QueueView> {
  return (await api.get(`/events/${eventId}/queue`)).data.data.queue
}

export async function leaveQueue(eventId: string): Promise<void> {
  await api.delete(`/events/${eventId}/queue`)
}

export async function getQueueStats(eventId: string): Promise<QueueStats> {
  return (await api.get(`/events/${eventId}/queue/stats`)).data.data.queue
}

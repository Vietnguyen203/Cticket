import { api } from './client'
import type { PageMeta } from './types'

export interface StaffEvent {
  id: string
  title: string
  status: string
  schedules: Array<{ id: string; startAt: string; endAt: string; status: string; venueName: string }>
}

/** APP-S01: the events I am on the gate team of, with their upcoming / running schedules. */
export async function listStaffEvents(): Promise<StaffEvent[]> {
  return (await api.get('/staff/events')).data.data.events
}

export interface CheckInResult {
  checkIn: { id: string; checkedInAt: string; deviceId: string | null }
  ticket: { id: string; code: string; ticketTypeName: string; seatLabel: string | null; admissionNo: number; status: 'USED' }
  event: { id: string; title: string }
  schedule: { id: string; startAt: string }
  stats: { total: number; checkedIn: number } | null
}

/** CHK-01: the API checks the signature, the schedule, the time window and lets a ticket in ONCE. */
export async function checkIn(qrToken: string, scheduleId: string, deviceId?: string): Promise<CheckInResult> {
  return (await api.post('/check-ins', { qrToken, scheduleId, ...(deviceId ? { deviceId } : {}) })).data.data
}

export interface CheckInEntry {
  id: string
  checkedInAt: string
  deviceId: string | null
  staffName: string
  ticket: { id: string; code: string; ticketTypeName: string; seatLabel: string | null; admissionNo: number }
}

/** CHK-02: newest first. */
export async function listCheckIns(scheduleId: string, params: { page?: number; pageSize?: number }) {
  const res = await api.get(`/schedules/${scheduleId}/check-ins`, { params })
  return { checkIns: res.data.data.checkIns as CheckInEntry[], meta: res.data.meta as PageMeta }
}

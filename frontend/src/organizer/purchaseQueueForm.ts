import type { EventInput } from '../api/organizer'

/** Backend limits and defaults (PURCHASE_QUEUE in backend/src/config/constants.js). */
export const QUEUE_LIMITS = { maxCapacity: 10_000, minMinutes: 5, maxMinutes: 30, defaultCapacity: 100, defaultMinutes: 10 }

/** What is typed in the purchase-queue fields. */
export interface QueueForm {
  enabled: boolean
  capacity: string
  minutes: string
}

export const DEFAULT_QUEUE_FORM: QueueForm = { enabled: false, capacity: String(QUEUE_LIMITS.defaultCapacity), minutes: String(QUEUE_LIMITS.defaultMinutes) }

/** What is wrong with each field (null: fine). */
export function queueProblems(form: QueueForm) {
  const capacity = Number(form.capacity)
  const minutes = Number(form.minutes)
  return {
    capacity:
      Number.isInteger(capacity) && capacity >= 1 && capacity <= QUEUE_LIMITS.maxCapacity ? null : `Từ 1 đến ${QUEUE_LIMITS.maxCapacity.toLocaleString('vi-VN')}.`,
    minutes:
      Number.isInteger(minutes) && minutes >= QUEUE_LIMITS.minMinutes && minutes <= QUEUE_LIMITS.maxMinutes
        ? null
        : `Từ ${QUEUE_LIMITS.minMinutes} đến ${QUEUE_LIMITS.maxMinutes} phút.`,
  }
}

/** The API fields for a new event (all three, so what the organizer saw is what is saved). */
export function queueInput(form: QueueForm): Pick<EventInput, 'queueEnabled' | 'queueCapacity' | 'queueSessionMinutes'> {
  return { queueEnabled: form.enabled, queueCapacity: Number(form.capacity), queueSessionMinutes: Number(form.minutes) }
}

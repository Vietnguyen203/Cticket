import type { QueueView } from '../api/queue'

/** Phase 21: what the seat page shows for a purchase queue (pure, tested). */

/** "khoảng 5 phút", "dưới 1 phút", "khoảng 1 giờ 20 phút". */
export function formatWait(seconds: number | null): string {
  if (seconds === null) return ''
  if (seconds < 60) return 'dưới 1 phút'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `khoảng ${minutes} phút`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `khoảng ${hours} giờ${rest > 0 ? ` ${rest} phút` : ''}`
}

/**
 * How far along the line I am (0–100), from the place I had when I first
 * joined: 20 ahead at first and 5 now → 75%.
 */
export function queueProgress(firstPlace: number | null, place: number | null): number {
  if (!firstPlace || !place || firstPlace <= 1) return place === 1 ? 95 : 0
  return Math.min(95, Math.max(0, Math.round(((firstPlace - place) / (firstPlace - 1)) * 100)))
}

/** Does the page show the waiting room instead of the seat map? (Someone with an open order is never held back.) */
export function mustWait(view: QueueView | undefined, hasOpenOrder: boolean): boolean {
  return !hasOpenOrder && view?.enabled === true && view.state !== 'ACTIVE'
}

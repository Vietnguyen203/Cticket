import type { EventSummary } from '../api/types'

/**
 * How full an event is, for the badge on its card: sold out, or almost (a
 * fifth or less of the places left, or 10 or fewer). The list API counts
 * the places (cached for a minute: the seat map has the exact figure).
 */
export type Stock = 'SOLD_OUT' | 'LOW' | null

export function stockOf(places: EventSummary['places']): Stock {
  if (!places || places.total <= 0) return null
  if (places.left <= 0) return 'SOLD_OUT'
  if (places.left <= 10 || places.left / places.total <= 0.2) return 'LOW'
  return null
}

export const STOCK_LABEL: Record<Exclude<Stock, null>, string> = { SOLD_OUT: 'Hết vé', LOW: 'Sắp hết vé' }

/** Cities of a list of events with how many events each, most first (the home page's "by city"). */
export function citiesOf(events: EventSummary[], max = 8): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const event of events) for (const city of event.cities) counts.set(city, (counts.get(city) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi')).slice(0, max)
}

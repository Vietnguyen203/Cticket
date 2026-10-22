import type { LineupItem } from '../api/types'

/**
 * "Nghệ sĩ khách mời": the guest artists of an event, by name. An event has
 * many programmes and acts, so no times or running order here: only who takes
 * part. Stored in the event's `lineup` (items { artist, time: null, note: null }).
 */

/** The limit (the API and the database refuse more). */
export const MAX_LINEUP_ITEMS = 50

/** One line of the editor, as typed. */
export interface LineupRow {
  key: number
  artist: string
}

let nextKey = 1
export const newRow = (item?: LineupItem): LineupRow => ({ key: nextKey++, artist: item?.artist ?? '' })

/** What is sent: names in the order entered, trimmed; empty lines and repeated names left out. */
export function toLineup(rows: LineupRow[]): LineupItem[] {
  const seen = new Set<string>()
  const items: LineupItem[] = []
  for (const row of rows) {
    const artist = row.artist.trim().replace(/\s+/g, ' ')
    if (!artist || seen.has(artist.toLocaleLowerCase('vi'))) continue
    seen.add(artist.toLocaleLowerCase('vi'))
    items.push({ artist, time: null, note: null })
  }
  return items
}

/** Same names in the same order (older saved items may still carry a time or a note: not shown, not compared). */
export const sameLineup = (a: LineupItem[], b: LineupItem[]) => a.length === b.length && a.every((item, i) => item.artist === b[i].artist)

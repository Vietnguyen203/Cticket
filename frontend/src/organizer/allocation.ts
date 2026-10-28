import type { LayoutZone, ScheduleTicketType } from '../api/admin'
import type { SeatPlanDetail } from '../api/organizer'

/**
 * Splitting a show's total attendance ("Tổng số người tham dự") into tiers
 * given to the zones the venue already has: a seated zone sells its seats
 * (buyers pick them on the map, front rows first in every listing), a
 * standing zone a number of tickets.
 */

const byRow = new Intl.Collator('vi', { numeric: true })

/** The venue's seats in the order tiers take them. */
export function orderedSeats(zones: LayoutZone[]) {
  return zones
    .filter((z) => z.kind === 'SEATED')
    .flatMap((zone) =>
      [...zone.seats]
        .sort((a, b) => byRow.compare(a.rowLabel, b.rowLabel) || a.seatNumber - b.seatNumber)
        .map((seat) => ({ ...seat, zoneId: zone.id })),
    )
}

/** Seats not in any tier yet, in order. */
export function freeSeats(zones: LayoutZone[], plan: SeatPlanDetail) {
  const taken = new Set(plan.assignments.map((a) => a.seatId))
  return orderedSeats(zones).filter((seat) => !taken.has(seat.id))
}

/** The free seats of the chosen zones, in order (a zone partly taken gives what is left of it). */
export function freeSeatsOfZones(zones: LayoutZone[], plan: SeatPlanDetail, zoneIds: string[]): string[] {
  const chosen = new Set(zoneIds)
  return freeSeats(zones, plan)
    .filter((seat) => chosen.has(seat.zoneId))
    .map((seat) => seat.id)
}

/** A tier already given to a zone of the venue. */
export interface ZoneTier {
  id: string
  name: string
  price: number
  places: number
}

/** One zone of the venue as a line of "Hạng vé theo khu": what it holds, and the tiers it sells. */
export interface ZoneLine {
  zone: LayoutZone
  seated: boolean
  /** Seats of a seated zone / capacity of a standing zone */
  places: number
  /** Seats of a seated zone still in no tier (standing: places minus what its tiers sell) */
  free: number
  tiers: ZoneTier[]
}

/** The venue's zones (seated ones with seats, every standing one) with the tiers given to them. */
export function zoneLines(zones: LayoutZone[], plan: SeatPlanDetail, ticketTypes: ScheduleTicketType[]): ZoneLine[] {
  const typeOfSeat = new Map(plan.assignments.map((a) => [a.seatId, a.ticketTypeId]))
  const active = ticketTypes.filter((tt) => tt.status === 'ACTIVE')
  return zones
    .filter((z) => z.kind === 'STANDING' || z.seats.length > 0)
    .map((zone) => {
      if (zone.kind === 'SEATED') {
        const count = new Map<string, number>()
        for (const seat of zone.seats) {
          const type = typeOfSeat.get(seat.id)
          if (type) count.set(type, (count.get(type) ?? 0) + 1)
        }
        const tiers = active.filter((tt) => count.has(tt.id)).map((tt) => ({ id: tt.id, name: tt.name, price: tt.price, places: count.get(tt.id)! }))
        const taken = [...count.values()].reduce((a, b) => a + b, 0)
        return { zone, seated: true, places: zone.seats.length, free: zone.seats.length - taken, tiers }
      }
      const tiers = active
        .filter((tt) => tt.inventoryMode === 'GENERAL_ADMISSION' && tt.venueZoneId === zone.id)
        .map((tt) => ({ id: tt.id, name: tt.name, price: tt.price, places: tt.capacity ?? 0 }))
      const sold = tiers.reduce((sum, tt) => sum + tt.places, 0)
      return { zone, seated: false, places: zone.capacity ?? 0, free: Math.max(0, (zone.capacity ?? 0) - sold), tiers }
    })
}

/** A ticket type code from the zone's code ("Khu A" → "A"), unique in the show ("A-2" if taken). */
export function tierCode(zoneCode: string, taken: string[]): string {
  const base = (zoneCode.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Đ/g, 'D').replace(/[^A-Z0-9_-]/g, '') || 'HANG').slice(0, 40)
  const used = new Set(taken.map((c) => c.toUpperCase()))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** What the organizer typed for one zone (the count follows the total until it is typed). */
export interface TierDraft {
  name: string
  price: string
  typed: string | null
  maxPerOrder: string
}

/** One zone's line worked out: the count shown, and what is wrong with it if it is to be assigned. */
export interface TierRow {
  line: ZoneLine
  draft: TierDraft
  count: string
  places: number
  /** a price is typed: this zone is assigned by "Xác nhận" */
  chosen: boolean
  problem: string | null
}

const vn = (x: number) => x.toLocaleString('vi-VN')

/**
 * The tier lines of the zones with free places, for one "Xác nhận": counts
 * not typed share what is left of the total, zone after zone; the zones with
 * a price are the ones assigned, and together they must fit in what is left.
 */
export function tierRows(lines: ZoneLine[], drafts: Record<string, TierDraft>, remaining: number) {
  const rows: TierRow[] = []
  let left = Math.max(0, remaining)
  for (const line of lines.filter((l) => l.free > 0)) {
    const draft = drafts[line.zone.id] ?? { name: line.zone.name, price: '', typed: null, maxPerOrder: '' }
    const count = draft.typed ?? String(Math.min(line.free, left))
    const places = Number(count)
    if (Number.isInteger(places) && places > 0) left = Math.max(0, left - places)
    const chosen = draft.price !== ''
    // Checked once the zone is to be assigned (a price) or its count was typed.
    const problem = !chosen && draft.typed === null
      ? null
      : !draft.name.trim()
        ? 'Nhập tên hạng.'
        : !Number.isInteger(places) || places < 1
          ? line.seated
            ? 'Nhập số ghế (số nguyên dương).'
            : 'Nhập số vé (số nguyên dương).'
          : places > line.free
            ? `Khu còn ${vn(line.free)} ${line.seated ? 'ghế trống' : 'chỗ'}.`
            : places > remaining
              ? `Chỉ còn ${vn(Math.max(0, remaining))} người chưa xếp (tổng số người tham dự).`
              : null
    rows.push({ line, draft, count, places, chosen, problem })
  }
  const chosen = rows.filter((row) => row.chosen)
  const total = chosen.reduce((sum, row) => sum + (Number.isInteger(row.places) && row.places > 0 ? row.places : 0), 0)
  const overTotal =
    total > remaining ? `Các khu đã nhập giá cộng lại ${vn(total)} người, chỉ còn ${vn(Math.max(0, remaining))} người chưa xếp (tổng số người tham dự).` : null
  return { rows, chosen, overTotal }
}

/** The whole seat plan with `seatIds` added for a tier (the API replaces the plan). */
export function planWith(plan: SeatPlanDetail, ticketTypeId: string, seatIds: string[]) {
  return planWithAll(plan, [{ ticketTypeId, seatIds }])
}

/** The whole seat plan with the seats of several tiers added: one save for many zones. */
export function planWithAll(plan: SeatPlanDetail, additions: Array<{ ticketTypeId: string; seatIds: string[] }>) {
  const byType = new Map<string, string[]>()
  for (const { seatId, ticketTypeId: type } of plan.assignments) byType.set(type, [...(byType.get(type) ?? []), seatId])
  for (const { ticketTypeId, seatIds } of additions) byType.set(ticketTypeId, [...(byType.get(ticketTypeId) ?? []), ...seatIds])
  return [...byType.entries()].map(([type, ids]) => ({ ticketTypeId: type, seatIds: ids }))
}

/** Where a tier's seats are: "Khu A: hàng A–E", per zone, rows in order. */
export function seatRangeLabel(zones: LayoutZone[], seatIds: string[]): string {
  const wanted = new Set(seatIds)
  const parts: string[] = []
  for (const zone of zones.filter((z) => z.kind === 'SEATED')) {
    const rows = [...new Set(zone.seats.filter((s) => wanted.has(s.id)).map((s) => s.rowLabel))].sort(byRow.compare)
    if (rows.length === 0) continue
    parts.push(`${zone.name}: hàng ${rows[0]}${rows.length > 1 ? `–${rows.at(-1)}` : ''}`)
  }
  return parts.join('; ')
}

/** The whole seat plan with `seatIds` taken off a tier (the other tiers and seats stay). */
export function planWithout(plan: SeatPlanDetail, ticketTypeId: string, seatIds: string[]) {
  const off = new Set(seatIds)
  return planWith({ ...plan, assignments: plan.assignments.filter((a) => !(a.ticketTypeId === ticketTypeId && off.has(a.seatId))) }, ticketTypeId, []).filter(
    (entry) => entry.seatIds.length > 0,
  )
}

/**
 * How the total is split so far, counted as the API counts it (allocatedPlaces):
 * every seat in the seat plan (a paused tier keeps its seats), and the
 * standing tickets of the active standing tiers. remaining < 0: over the total.
 */
export function allocation(capacity: number | null | undefined, ticketTypes: ScheduleTicketType[], seatsByTicketType: Record<string, number>) {
  const active = ticketTypes.filter((tt) => tt.status === 'ACTIVE')
  const seated = Object.values(seatsByTicketType).reduce((sum, n) => sum + n, 0)
  const standing = active.filter((tt) => tt.inventoryMode === 'GENERAL_ADMISSION').reduce((sum, tt) => sum + (tt.capacity ?? 0), 0)
  const allocated = seated + standing
  return { seated, standing, allocated, remaining: capacity ? capacity - allocated : null }
}

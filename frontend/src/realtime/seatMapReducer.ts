import type { SeatMap, SeatStatus, TicketTypeAvailability } from '../api/types'

/**
 * State of the seat selection page: the seat map loaded over REST, kept up to
 * date by WebSocket messages, plus what this user has picked. A pure reducer,
 * so the tricky rules below are unit-tested.
 *
 * - Every seat carries a `version` (bumped by the API on each change). An
 *   update is applied only if its version is newer: messages that arrive late,
 *   twice, or after a fresher REST reload change nothing.
 * - Updates that arrive before the first REST load are kept and applied on top of it.
 * - A seat this user picked that someone else takes is unpicked, and the
 *   user is told — except while this user's own hold request is in flight
 *   (their own seats turning HELD is not news).
 * - Changing a held order (BKG-02): the picks start as what the order holds.
 *   Its seats are HELD on the shared map but stay pickable for this user, and
 *   its standing tickets count as available to them.
 */

/** Per order (backend ORDER_LIMITS.MAX_TICKETS_PER_ORDER); each ticket type's maxPerOrder applies too. */
export const MAX_TICKETS_PER_ORDER = 8

export interface SeatUpdateMessage {
  type: 'SEAT_HELD' | 'SEAT_RELEASED' | 'SEAT_SOLD' | 'SEAT_BLOCKED'
  scheduleId: string
  seats: Array<{ seatId: string; status: SeatStatus; version: number }>
}

export interface InventoryUpdateMessage {
  type: 'INVENTORY_UPDATED'
  scheduleId: string
  ticketTypes: Array<{ ticketTypeId: string; available: number }>
}

export type LiveUpdate = SeatUpdateMessage | InventoryUpdateMessage

/** The held order being changed, as it is on the server. */
export interface EditedOrder {
  id: string
  orderCode: string
  expiresAt: string
  seatIds: string[]
  gaQuantities: Record<string, number>
}

export interface SeatMapState {
  map: SeatMap | null
  seats: Record<string, { status: SeatStatus; version: number }>
  /** Standing tickets left, per ticket type */
  gaAvailable: Record<string, number>
  pending: LiveUpdate[]
  /** Picked seat ids, in the order they were picked */
  selected: string[]
  /** Standing tickets picked, per ticket type */
  gaQuantities: Record<string, number>
  /** Picked seats someone else just took */
  taken: string[]
  holding: boolean
  /** Why the last pick was refused (limits) */
  notice: string | null
  /** BKG-02: the held order the picks will replace */
  editing: EditedOrder | null
}

export type SeatMapAction =
  | { type: 'loaded'; map: SeatMap }
  | { type: 'live'; message: LiveUpdate }
  | { type: 'toggleSeat'; seatId: string }
  | { type: 'setGaQuantity'; ticketTypeId: string; quantity: number }
  | { type: 'holdStarted' }
  | { type: 'holdFailed' }
  | { type: 'dismissNotices' }
  /** Start (or refresh) changing a held order; null when it is no longer held */
  | { type: 'editOrder'; order: EditedOrder | null }

export const initialSeatMapState: SeatMapState = {
  map: null,
  seats: {},
  gaAvailable: {},
  pending: [],
  selected: [],
  gaQuantities: {},
  taken: [],
  holding: false,
  notice: null,
  editing: null,
}

export function seatMapReducer(state: SeatMapState, action: SeatMapAction): SeatMapState {
  switch (action.type) {
    case 'loaded': {
      const seats = { ...state.seats }
      for (const zone of action.map.zones) {
        for (const seat of zone.seats) {
          const known = seats[seat.seatId]
          // A live update applied meanwhile may be newer than this response.
          if (!known || seat.version >= known.version) seats[seat.seatId] = { status: seat.status, version: seat.version }
        }
      }
      const gaAvailable = Object.fromEntries(action.map.ticketTypes.map((tt) => [tt.id, tt.available]))
      let next: SeatMapState = { ...state, map: action.map, seats, gaAvailable, pending: [] }
      for (const message of state.pending) next = applyLive(next, message)
      return dropUnavailable(next)
    }
    case 'live':
      return state.map ? dropUnavailable(applyLive(state, action.message)) : { ...state, pending: [...state.pending, action.message] }
    case 'toggleSeat':
      return toggleSeat(state, action.seatId)
    case 'setGaQuantity':
      return setGaQuantity(state, action.ticketTypeId, action.quantity)
    case 'holdStarted':
      return { ...state, holding: true, notice: null, taken: [] }
    case 'holdFailed':
      return dropUnavailable({ ...state, holding: false })
    case 'dismissNotices':
      return { ...state, notice: null, taken: [] }
    case 'editOrder':
      if (action.order) {
        const { seatIds, gaQuantities } = action.order
        return { ...state, editing: action.order, selected: seatIds, gaQuantities, notice: null, taken: [] }
      }
      // The order ended (expired, paid…): its picks go with it. Not editing: nothing to do.
      return state.editing ? { ...state, editing: null, selected: [], gaQuantities: {}, notice: null } : state
    default:
      return state
  }
}

function applyLive(state: SeatMapState, message: LiveUpdate): SeatMapState {
  if (message.type === 'INVENTORY_UPDATED') {
    const gaAvailable = { ...state.gaAvailable }
    for (const { ticketTypeId, available } of message.ticketTypes) gaAvailable[ticketTypeId] = available
    return { ...state, gaAvailable }
  }
  let seats = state.seats
  for (const update of message.seats) {
    const known = seats[update.seatId]
    if (known && update.version <= known.version) continue // late or duplicate
    if (seats === state.seats) seats = { ...seats }
    seats[update.seatId] = { status: update.status, version: update.version }
  }
  return seats === state.seats ? state : { ...state, seats }
}

export const isMine = (state: SeatMapState, seatId: string) => state.editing?.seatIds.includes(seatId) ?? false

/** A seat this user may pick: available, or held by the order being changed. */
const pickable = (state: SeatMapState, seatId: string) =>
  state.seats[seatId]?.status === 'AVAILABLE' || (state.seats[seatId]?.status === 'HELD' && isMine(state, seatId))

/** Standing tickets this user can have: what is left for everyone plus what their order already holds. */
export const gaLeftFor = (state: SeatMapState, ticketTypeId: string) =>
  (state.gaAvailable[ticketTypeId] ?? 0) + (state.editing?.gaQuantities[ticketTypeId] ?? 0)

/** Unpick seats that are no longer available, and standing tickets beyond what is left. */
function dropUnavailable(state: SeatMapState): SeatMapState {
  if (state.holding) return state
  const lost = state.selected.filter((seatId) => !pickable(state, seatId))
  let gaQuantities = state.gaQuantities
  for (const [ticketTypeId, quantity] of Object.entries(state.gaQuantities)) {
    const left = gaLeftFor(state, ticketTypeId)
    if (quantity > left) gaQuantities = { ...gaQuantities, [ticketTypeId]: left }
  }
  if (lost.length === 0 && gaQuantities === state.gaQuantities) return state
  return {
    ...state,
    selected: state.selected.filter((seatId) => !lost.includes(seatId)),
    taken: [...state.taken, ...lost.filter((seatId) => !state.taken.includes(seatId))],
    gaQuantities,
  }
}

// --- picking ----------------------------------------------------------------

function ticketTypeOf(state: SeatMapState, seatId: string): TicketTypeAvailability | undefined {
  const seat = state.map?.zones.flatMap((zone) => zone.seats).find((s) => s.seatId === seatId)
  return state.map?.ticketTypes.find((tt) => tt.id === seat?.ticketTypeId)
}

const totalPicked = (state: SeatMapState) =>
  state.selected.length + Object.values(state.gaQuantities).reduce((sum, quantity) => sum + quantity, 0)

function pickedOfType(state: SeatMapState, ticketTypeId: string): number {
  const seats = state.selected.filter((seatId) => ticketTypeOf(state, seatId)?.id === ticketTypeId).length
  return seats + (state.gaQuantities[ticketTypeId] ?? 0)
}

function toggleSeat(state: SeatMapState, seatId: string): SeatMapState {
  if (state.holding) return state
  if (state.selected.includes(seatId)) {
    return { ...state, selected: state.selected.filter((id) => id !== seatId), notice: null }
  }
  if (!pickable(state, seatId)) return state
  const ticketType = ticketTypeOf(state, seatId)
  // A seat the order already holds can be picked back even if its type was paused meanwhile.
  if (!ticketType || (ticketType.status !== 'ACTIVE' && !isMine(state, seatId))) {
    return { ...state, notice: 'Ghế này hiện không bán.' }
  }
  if (totalPicked(state) >= MAX_TICKETS_PER_ORDER) {
    return { ...state, notice: `Mỗi đơn tối đa ${MAX_TICKETS_PER_ORDER} vé.` }
  }
  if (pickedOfType(state, ticketType.id) >= ticketType.maxPerOrder) {
    return { ...state, notice: `Hạng ${ticketType.name}: tối đa ${ticketType.maxPerOrder} vé mỗi đơn.` }
  }
  return { ...state, selected: [...state.selected, seatId], notice: null }
}

function setGaQuantity(state: SeatMapState, ticketTypeId: string, wanted: number): SeatMapState {
  if (state.holding) return state
  const ticketType = state.map?.ticketTypes.find((tt) => tt.id === ticketTypeId)
  if (!ticketType) return state
  const current = state.gaQuantities[ticketTypeId] ?? 0
  const others = totalPicked(state) - current
  const limits: Array<[number, string]> = [
    [MAX_TICKETS_PER_ORDER - others, `Mỗi đơn tối đa ${MAX_TICKETS_PER_ORDER} vé.`],
    [ticketType.maxPerOrder, `Hạng ${ticketType.name}: tối đa ${ticketType.maxPerOrder} vé mỗi đơn.`],
    [gaLeftFor(state, ticketTypeId), `Hạng ${ticketType.name} chỉ còn ${gaLeftFor(state, ticketTypeId)} vé.`],
  ]
  let quantity = Math.max(0, Math.floor(wanted))
  let notice: string | null = null
  for (const [max, message] of limits) {
    if (quantity > max) {
      quantity = Math.max(0, max)
      notice = message
    }
  }
  return { ...state, gaQuantities: { ...state.gaQuantities, [ticketTypeId]: quantity }, notice }
}

// --- summary ----------------------------------------------------------------

export interface SelectionLine {
  label: string
  ticketTypeName: string
  quantity: number
  amount: number
}

/** What is picked and the estimated total (the API computes the real price). */
export function selectionSummary(state: SeatMapState): { lines: SelectionLine[]; count: number; total: number } {
  if (!state.map) return { lines: [], count: 0, total: 0 }
  const seatsById = new Map(state.map.zones.flatMap((zone) => zone.seats.map((seat) => [seat.seatId, { seat, zone }])))
  const typesById = new Map(state.map.ticketTypes.map((tt) => [tt.id, tt]))
  const lines: SelectionLine[] = []
  for (const seatId of state.selected) {
    const found = seatsById.get(seatId)
    if (!found) continue
    const ticketType = typesById.get(found.seat.ticketTypeId ?? '')
    lines.push({
      label: `${found.zone.name} - ${found.seat.code}`,
      ticketTypeName: ticketType?.name ?? '',
      quantity: 1,
      amount: found.seat.price ?? ticketType?.price ?? 0,
    })
  }
  for (const [ticketTypeId, quantity] of Object.entries(state.gaQuantities)) {
    const ticketType = typesById.get(ticketTypeId)
    if (!ticketType || quantity <= 0) continue
    lines.push({ label: ticketType.name, ticketTypeName: ticketType.name, quantity, amount: ticketType.price * quantity })
  }
  return {
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    total: lines.reduce((sum, line) => sum + line.amount, 0),
  }
}

/** BKG-02: what "Cập nhật đơn" would change in the held order (standing tickets as old → new quantity). */
export function editChanges(state: SeatMapState): {
  added: string[]
  removed: string[]
  ga: Array<{ ticketTypeId: string; from: number; to: number }>
  none: boolean
} {
  const order = state.editing
  if (!order) return { added: [], removed: [], ga: [], none: true }
  const added = state.selected.filter((seatId) => !order.seatIds.includes(seatId))
  const removed = order.seatIds.filter((seatId) => !state.selected.includes(seatId))
  const ga = [...new Set([...Object.keys(order.gaQuantities), ...Object.keys(state.gaQuantities)])]
    .map((ticketTypeId) => ({ ticketTypeId, from: order.gaQuantities[ticketTypeId] ?? 0, to: state.gaQuantities[ticketTypeId] ?? 0 }))
    .filter((change) => change.from !== change.to)
  return { added, removed, ga, none: added.length + removed.length + ga.length === 0 }
}

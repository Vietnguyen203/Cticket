/**
 * The WebSocket protocol: room names and the shape of every server message.
 * See docs/phase-7-websocket-design.md, section 3.
 */
const MESSAGE = Object.freeze({
  // Seat map of a schedule (room schedule:{id})
  SEAT_HELD: 'SEAT_HELD',
  SEAT_RELEASED: 'SEAT_RELEASED',
  SEAT_SOLD: 'SEAT_SOLD', // Phase 8
  SEAT_BLOCKED: 'SEAT_BLOCKED',
  INVENTORY_UPDATED: 'INVENTORY_UPDATED',
  // Personal (room user:{id})
  ORDER_UPDATED: 'ORDER_UPDATED', // BKG-02: seats / tickets of a held order changed
  ORDER_EXPIRED: 'ORDER_EXPIRED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_PAID: 'ORDER_PAID', // Phase 8
  ORDER_REFUNDED: 'ORDER_REFUNDED',
  PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  TICKET_ISSUED: 'TICKET_ISSUED', // Phase 9
  NOTIFICATION: 'NOTIFICATION', // a new in-app notification (Q-05)
  CHECK_IN_SUCCESS: 'CHECK_IN_SUCCESS', // Phase 10: to the event's staff and organizer only (CHK-03)
});

const scheduleRoom = (scheduleId) => `schedule:${scheduleId}`;
const userRoom = (userId) => `user:${userId}`;

/** @param {Array<{ seat_id: string, status: string, version: number }>} rows */
function seatUpdate(type, scheduleId, rows) {
  return {
    type,
    scheduleId,
    seats: rows.map((row) => ({ seatId: row.seat_id, status: row.status, version: row.version })),
  };
}

/** @param {Array<{ ticket_type_id: string, available: number }>} rows */
function inventoryUpdate(scheduleId, rows) {
  return {
    type: MESSAGE.INVENTORY_UPDATED,
    scheduleId,
    ticketTypes: rows.map((row) => ({ ticketTypeId: row.ticket_type_id, available: row.available })),
  };
}

module.exports = { MESSAGE, scheduleRoom, userRoom, seatUpdate, inventoryUpdate };

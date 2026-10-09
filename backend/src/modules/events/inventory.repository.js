/**
 * Seat plan (configuration) and schedule inventory (reserved seats + GA counters).
 */

// ---------------------------------------------------------------------------
// Seat plan
// ---------------------------------------------------------------------------

/** Replace a schedule's whole seat plan in the caller's transaction. */
async function replacePlan(db, scheduleId, assignments) {
  await db.query(`DELETE FROM schedule_seat_plan WHERE schedule_id = $1`, [scheduleId]);
  if (assignments.length === 0) return;
  await db.query(
    `INSERT INTO schedule_seat_plan (schedule_id, seat_id, ticket_type_id)
     SELECT $1, seat_id, ticket_type_id FROM unnest($2::uuid[], $3::uuid[]) AS t (seat_id, ticket_type_id)`,
    [scheduleId, assignments.map((a) => a.seatId), assignments.map((a) => a.ticketTypeId)],
  );
}

async function listPlan(db, scheduleId) {
  const { rows } = await db.query(
    `SELECT seat_id, ticket_type_id FROM schedule_seat_plan WHERE schedule_id = $1 ORDER BY seat_id`,
    [scheduleId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Sellability check (submit / approve)
// ---------------------------------------------------------------------------

/**
 * Per SCHEDULED schedule of an event: how many ACTIVE ticket types it has, and
 * how many RESERVED ticket types have no seat at all in the plan.
 */
async function sellableSummary(db, eventId) {
  const { rows } = await db.query(
    `SELECT es.id AS schedule_id,
            count(tt.id) FILTER (WHERE tt.status = 'ACTIVE') AS active_ticket_types,
            count(tt.id) FILTER (
              WHERE tt.inventory_mode = 'RESERVED'
                AND NOT EXISTS (SELECT 1 FROM schedule_seat_plan p WHERE p.ticket_type_id = tt.id)
            ) AS reserved_without_seats
     FROM event_schedules es
     LEFT JOIN ticket_types tt ON tt.schedule_id = es.id
     WHERE es.event_id = $1 AND es.status = 'SCHEDULED'
     GROUP BY es.id`,
    [eventId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Inventory generation — idempotent: ON CONFLICT DO NOTHING on the unique keys,
// so running it twice (retry, admin repair) never creates duplicates.
// ---------------------------------------------------------------------------

async function generateReservedInventory(db, eventId) {
  const { rowCount } = await db.query(
    `INSERT INTO schedule_seats (schedule_id, seat_id, ticket_type_id, price, currency)
     SELECT p.schedule_id, p.seat_id, p.ticket_type_id, tt.price, tt.currency
     FROM schedule_seat_plan p
     JOIN ticket_types tt ON tt.id = p.ticket_type_id
     JOIN event_schedules es ON es.id = p.schedule_id
     WHERE es.event_id = $1 AND es.status = 'SCHEDULED'
     ON CONFLICT (schedule_id, seat_id) DO NOTHING`,
    [eventId],
  );
  return rowCount;
}

async function generateGaInventory(db, eventId) {
  const { rowCount } = await db.query(
    `INSERT INTO ga_inventory (ticket_type_id, schedule_id, capacity)
     SELECT tt.id, tt.schedule_id, tt.capacity
     FROM ticket_types tt
     JOIN event_schedules es ON es.id = tt.schedule_id
     WHERE es.event_id = $1 AND es.status = 'SCHEDULED' AND tt.inventory_mode = 'GENERAL_ADMISSION'
     ON CONFLICT (ticket_type_id) DO NOTHING`,
    [eventId],
  );
  return rowCount;
}

/** Keeps the FIRST generation time on re-runs. */
async function markGenerated(db, eventId) {
  await db.query(
    `UPDATE event_schedules SET inventory_generated_at = coalesce(inventory_generated_at, now())
     WHERE event_id = $1 AND status = 'SCHEDULED'`,
    [eventId],
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Remaining tickets per ticket type. A HELD seat whose hold expired counts as
 * available (the hold is reclaimed lazily by the booking flow in Phase 5).
 */
async function availabilityBySchedule(db, scheduleId) {
  const { rows } = await db.query(
    `SELECT tt.id, tt.code, tt.name, tt.description, tt.price, tt.currency, tt.inventory_mode,
            tt.status, tt.max_per_order, tt.venue_zone_id,
            CASE WHEN tt.inventory_mode = 'GENERAL_ADMISSION' THEN g.capacity ELSE seats.total END AS total,
            CASE WHEN tt.inventory_mode = 'GENERAL_ADMISSION'
                 THEN g.capacity - g.held_quantity - g.sold_quantity - g.blocked_quantity
                 ELSE seats.available END AS available
     FROM ticket_types tt
     LEFT JOIN ga_inventory g ON g.ticket_type_id = tt.id
     LEFT JOIN LATERAL (
       SELECT count(*) AS total,
              count(*) FILTER (
                WHERE s.status = 'AVAILABLE' OR (s.status = 'HELD' AND s.hold_expires_at <= now())
              ) AS available
       FROM schedule_seats s
       WHERE s.schedule_id = tt.schedule_id AND s.ticket_type_id = tt.id
     ) seats ON true
     WHERE tt.schedule_id = $1
     ORDER BY tt.sort_order, tt.price DESC, tt.code`,
    [scheduleId],
  );
  return rows;
}

/** Zones of the schedule's venue (read model join for the seat map). */
async function zonesForSchedule(db, scheduleId) {
  const { rows } = await db.query(
    `SELECT z.id, z.code, z.name, z.kind, z.capacity
     FROM venue_zones z
     JOIN event_schedules es ON es.venue_id = z.venue_id
     WHERE es.id = $1
     ORDER BY z.code`,
    [scheduleId],
  );
  return rows;
}

async function seatMapRows(db, scheduleId) {
  const { rows } = await db.query(
    `SELECT s.seat_id, se.venue_zone_id, se.seat_code, se.row_label, se.seat_number, se.seat_type, se.x, se.y,
            s.ticket_type_id, s.price, s.version,
            CASE WHEN s.status = 'HELD' AND s.hold_expires_at <= now() THEN 'AVAILABLE' ELSE s.status::text END AS status
     FROM schedule_seats s
     JOIN seats se ON se.id = s.seat_id
     WHERE s.schedule_id = $1
     ORDER BY se.row_label, se.seat_number, se.seat_code`,
    [scheduleId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Block / unblock
// ---------------------------------------------------------------------------

/**
 * Lock the requested seats in seat_id order — the same order the booking flow
 * will use — so blocking and holding can never deadlock each other.
 */
async function lockScheduleSeats(db, scheduleId, seatIds) {
  const { rows } = await db.query(
    `SELECT seat_id, status FROM schedule_seats
     WHERE schedule_id = $1 AND seat_id = ANY($2::uuid[])
     ORDER BY seat_id
     FOR UPDATE`,
    [scheduleId, seatIds],
  );
  return rows;
}

async function blockSeats(db, scheduleId, seatIds, reason) {
  await db.query(
    `UPDATE schedule_seats SET status = 'BLOCKED', blocked_reason = $3
     WHERE schedule_id = $1 AND seat_id = ANY($2::uuid[]) AND status = 'AVAILABLE'`,
    [scheduleId, seatIds, reason],
  );
}

async function unblockSeats(db, scheduleId, seatIds) {
  await db.query(
    `UPDATE schedule_seats SET status = 'AVAILABLE', blocked_reason = NULL
     WHERE schedule_id = $1 AND seat_id = ANY($2::uuid[]) AND status = 'BLOCKED'`,
    [scheduleId, seatIds],
  );
}

/**
 * Atomic conditional updates on the GA counters: the WHERE clause re-checks
 * availability at the moment of the write, so there is no "read, then write"
 * gap for a concurrent request to slip through.
 * @returns {Promise<object|null>} the updated row, or null when there was not enough
 */
async function blockGa(db, { ticketTypeId, quantity }) {
  const { rows } = await db.query(
    `UPDATE ga_inventory SET blocked_quantity = blocked_quantity + $2
     WHERE ticket_type_id = $1
       AND capacity - held_quantity - sold_quantity - blocked_quantity >= $2
     RETURNING capacity, held_quantity, sold_quantity, blocked_quantity`,
    [ticketTypeId, quantity],
  );
  return rows[0] ?? null;
}

async function unblockGa(db, { ticketTypeId, quantity }) {
  const { rows } = await db.query(
    `UPDATE ga_inventory SET blocked_quantity = blocked_quantity - $2
     WHERE ticket_type_id = $1 AND blocked_quantity >= $2
     RETURNING capacity, held_quantity, sold_quantity, blocked_quantity`,
    [ticketTypeId, quantity],
  );
  return rows[0] ?? null;
}

module.exports = {
  replacePlan,
  listPlan,
  sellableSummary,
  generateReservedInventory,
  generateGaInventory,
  markGenerated,
  availabilityBySchedule,
  zonesForSchedule,
  seatMapRows,
  lockScheduleSeats,
  blockSeats,
  unblockSeats,
  blockGa,
  unblockGa,
};

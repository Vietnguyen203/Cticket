/**
 * check_ins: one row per ticket that went through a gate (UNIQUE ticket_id,
 * the last line of defence against a double entry).
 */

async function insert(db, { ticketId, eventId, scheduleId, staffUserId, deviceId }) {
  const { rows } = await db.query(
    `INSERT INTO check_ins (ticket_id, event_id, schedule_id, staff_user_id, device_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, checked_in_at, device_id`,
    [ticketId, eventId, scheduleId, staffUserId, deviceId ?? null],
  );
  return rows[0];
}

/** How a used ticket got in: when, at which gate, scanned by whom. */
async function findByTicket(db, ticketId) {
  const { rows } = await db.query(
    `SELECT c.checked_in_at, c.device_id, u.first_name AS staff_first_name, u.last_name AS staff_last_name
     FROM check_ins c JOIN users u ON u.id = c.staff_user_id
     WHERE c.ticket_id = $1`,
    [ticketId],
  );
  return rows[0] ?? null;
}

/** CHK-02: newest first. */
async function listBySchedule(db, { scheduleId, limit, offset }) {
  const { rows } = await db.query(
    `SELECT c.id, c.checked_in_at, c.device_id,
            t.id AS ticket_id, t.ticket_code, t.admission_no, oi.seat_label, oi.ticket_type_name,
            u.id AS staff_user_id, u.first_name AS staff_first_name, u.last_name AS staff_last_name,
            count(*) OVER () AS total_count
     FROM check_ins c
     JOIN tickets t ON t.id = c.ticket_id
     JOIN order_items oi ON oi.id = t.order_item_id
     JOIN users u ON u.id = c.staff_user_id
     WHERE c.schedule_id = $1
     ORDER BY c.checked_in_at DESC, c.id
     LIMIT $2 OFFSET $3`,
    [scheduleId, limit, offset],
  );
  return { rows, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

/**
 * CHK-03: tickets that can still come in (VALID) or came in (USED), per
 * ticket type. Refunded / cancelled tickets do not count.
 */
async function statsBySchedule(db, scheduleId) {
  const { rows } = await db.query(
    `SELECT oi.ticket_type_id, oi.ticket_type_name,
            count(*)::int AS total,
            count(*) FILTER (WHERE t.status = 'USED')::int AS checked_in
     FROM tickets t JOIN order_items oi ON oi.id = t.order_item_id
     WHERE t.schedule_id = $1 AND t.status IN ('VALID', 'USED')
     GROUP BY oi.ticket_type_id, oi.ticket_type_name
     ORDER BY oi.ticket_type_name`,
    [scheduleId],
  );
  return rows;
}

module.exports = { insert, findByTicket, listBySchedule, statsBySchedule };

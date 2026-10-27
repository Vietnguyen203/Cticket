/**
 * SQL for a user's own data: the export (everything about the user, as the
 * user can read it) and the deletion (anonymise what must be kept, delete the
 * rest). Every function takes `db` first (pool or transaction client).
 */

// --- export ------------------------------------------------------------------

async function profile(db, userId) {
  const { rows } = await db.query(
    `SELECT u.email, u.first_name, u.last_name, u.phone, u.status, u.email_verified_at, u.event_reminders, u.created_at,
            (SELECT array_agg(r.code ORDER BY r.code) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
            (SELECT enabled_at FROM user_totp WHERE user_id = u.id) AS two_factor_enabled_at
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** Signed-in devices: when, from where (IP), with what (browser). */
async function sessions(db, userId) {
  const { rows } = await db.query(
    `SELECT created_at, expires_at, ip_address::text AS ip_address, user_agent
     FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

async function orders(db, userId) {
  const { rows } = await db.query(
    `SELECT o.id, o.order_code, o.status, o.subtotal, o.discount_amount, o.total_amount, o.currency,
            o.created_at, o.checked_out_at, o.paid_at, o.cancelled_at, o.cancel_reason,
            o.terms_version, o.terms_accepted_at, o.refund_policy,
            e.title AS event_title, es.start_at, v.name AS venue_name,
            coalesce((SELECT json_agg(json_build_object('seat', i.seat_label, 'ticketType', i.ticket_type_name,
                                                        'quantity', i.quantity, 'unitPrice', i.unit_price, 'total', i.total_amount)
                                      ORDER BY i.created_at)
                      FROM order_items i WHERE i.order_id = o.id), '[]') AS items,
            coalesce((SELECT json_agg(json_build_object('provider', p.provider, 'status', p.status, 'amount', p.amount,
                                                        'paidAt', p.paid_at, 'createdAt', p.created_at)
                                      ORDER BY p.created_at)
                      FROM payments p WHERE p.order_id = o.id), '[]') AS payments,
            coalesce((SELECT json_agg(json_build_object('amount', r.amount, 'status', r.status, 'reason', r.reason,
                                                        'createdAt', r.created_at, 'completedAt', r.completed_at)
                                      ORDER BY r.created_at)
                      FROM refunds r WHERE r.order_id = o.id), '[]') AS refunds
     FROM orders o
     JOIN event_schedules es ON es.id = o.schedule_id
     JOIN events e ON e.id = es.event_id
     LEFT JOIN venues v ON v.id = es.venue_id
     WHERE o.user_id = $1
     ORDER BY o.created_at DESC`,
    [userId],
  );
  return rows;
}

/** Tickets: codes and use, never the QR secret. */
async function tickets(db, userId) {
  const { rows } = await db.query(
    `SELECT t.ticket_code, t.status, t.issued_at, t.used_at, t.cancelled_at, e.title AS event_title, es.start_at,
            i.seat_label, i.ticket_type_name,
            (SELECT max(c.checked_in_at) FROM check_ins c WHERE c.ticket_id = t.id) AS checked_in_at
     FROM tickets t
     JOIN events e ON e.id = t.event_id
     JOIN event_schedules es ON es.id = t.schedule_id
     LEFT JOIN order_items i ON i.id = t.order_item_id
     WHERE t.user_id = $1
     ORDER BY t.issued_at DESC`,
    [userId],
  );
  return rows;
}

async function reviews(db, userId) {
  const { rows } = await db.query(
    `SELECT e.title AS event_title, r.rating, r.comment, r.status, r.hidden_reason, r.organizer_reply, r.created_at, r.updated_at
     FROM reviews r JOIN events e ON e.id = r.event_id
     WHERE r.user_id = $1 ORDER BY r.created_at DESC`,
    [userId],
  );
  return rows;
}

async function waitlist(db, userId) {
  const { rows } = await db.query(
    `SELECT e.title AS event_title, es.start_at, tt.name AS ticket_type, w.quantity, w.status, w.offered_at, w.created_at
     FROM waitlist_entries w
     JOIN event_schedules es ON es.id = w.schedule_id
     JOIN events e ON e.id = es.event_id
     LEFT JOIN ticket_types tt ON tt.id = w.ticket_type_id
     WHERE w.user_id = $1 ORDER BY w.created_at DESC`,
    [userId],
  );
  return rows;
}

async function notifications(db, userId) {
  const { rows } = await db.query(
    `SELECT type, title, message, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

async function organizer(db, userId) {
  const { rows } = await db.query(
    `SELECT id, organization_name, description, tax_code, status, created_at,
            (SELECT count(*)::int FROM events WHERE organizer_id = o.id) AS events
     FROM organizers o WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

// --- deletion ------------------------------------------------------------------

/** What still ties the account to the platform; each one blocks the deletion. */
async function blockers(db, userId) {
  const { rows } = await db.query(
    `SELECT
       EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.code = 'ADMIN') AS admin,
       EXISTS (SELECT 1 FROM organizers o JOIN events e ON e.organizer_id = o.id WHERE o.user_id = $1) AS organizer_events,
       EXISTS (SELECT 1 FROM orders WHERE user_id = $1 AND status IN ('HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED')) AS open_order,
       EXISTS (SELECT 1 FROM tickets t JOIN event_schedules es ON es.id = t.schedule_id
               WHERE t.user_id = $1 AND t.status = 'VALID' AND es.status = 'SCHEDULED'
                 AND coalesce(es.end_at, es.start_at + interval '1 day') > now()) AS upcoming_tickets,
       EXISTS (SELECT 1 FROM refunds r JOIN orders o ON o.id = r.order_id
               WHERE o.user_id = $1 AND r.status IN ('PENDING', 'FAILED')) AS pending_refund`,
    [userId],
  );
  return rows[0];
}

/**
 * Personal data out, the row kept: orders, payments, refunds and tickets keep
 * their foreign key for the accounts, under a name that is no one's. The
 * email is freed (the person may sign up again); the password can never match.
 */
async function anonymise(db, userId, unusablePasswordHash) {
  await db.query(
    `UPDATE users
     SET email = 'deleted-' || id || '@deleted.invalid', first_name = 'Người dùng', last_name = 'đã xóa', phone = NULL,
         password_hash = $2, status = 'DELETED', event_reminders = false, deleted_at = now()
     WHERE id = $1`,
    [userId, unusablePasswordHash],
  );
}

/** Everything that is only about the person: sign-in, devices, roles, staff duties, messages. */
async function deletePersonalRows(db, userId) {
  for (const sql of [
    `DELETE FROM refresh_tokens WHERE user_id = $1`,
    `DELETE FROM user_tokens WHERE user_id = $1`,
    `DELETE FROM user_recovery_codes WHERE user_id = $1`,
    `DELETE FROM user_totp WHERE user_id = $1`,
    `DELETE FROM user_roles WHERE user_id = $1`,
    `DELETE FROM event_staff WHERE user_id = $1`,
    `DELETE FROM notifications WHERE user_id = $1`,
    // An organizer application without events (pending, rejected…) goes too.
    `DELETE FROM organizers WHERE user_id = $1`,
    // Ratings stay in the event's average; the words written are removed.
    `UPDATE reviews SET comment = NULL WHERE user_id = $1 AND comment IS NOT NULL`,
    // Places kept for this person go back to the list (the offer job hands them on).
    `UPDATE waitlist_entries SET status = 'CANCELLED' WHERE user_id = $1 AND status IN ('WAITING', 'OFFERED')`,
  ]) {
    await db.query(sql, [userId]);
  }
}

module.exports = {
  profile,
  sessions,
  orders,
  tickets,
  reviews,
  waitlist,
  notifications,
  organizer,
  blockers,
  anonymise,
  deletePersonalRows,
};

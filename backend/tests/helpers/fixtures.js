const { randomUUID } = require('node:crypto');

/**
 * Minimal raw-SQL factories for database-level tests. Every function takes a
 * pg client so fixtures live inside the test's (rolled back) transaction.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOLD_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PRICE = 500_000; // VND, integer minor units

const EXPIRING_ORDER_STATUSES = ['HELD', 'PAYMENT_PENDING', 'PAYMENT_FAILED'];
const PAID_ORDER_STATUSES = ['PAID', 'COMPLETED', 'REFUNDED'];

const uniqueSuffix = () => randomUUID().slice(0, 8);

async function createUser(client) {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, first_name, last_name)
     VALUES ($1, 'not-a-real-hash', 'Test', 'User') RETURNING *`,
    [`user-${uniqueSuffix()}@example.com`],
  );
  return rows[0];
}

async function createOrganizer(client, userId) {
  const { rows } = await client.query(
    `INSERT INTO organizers (user_id, organization_name) VALUES ($1, 'Test Organizer') RETURNING *`,
    [userId],
  );
  return rows[0];
}

/**
 * @param {Record<string, string[]>} layout  e.g. { A: ['A01', 'A02'], B: ['B01'] }
 * @returns venue row plus zones[code] = { id, seats: { seatCode: seatId } }
 */
async function createVenueWithSeats(client, layout) {
  const { rows: [venue] } = await client.query(
    `INSERT INTO venues (name, address_line, city, country)
     VALUES ('Test Hall', '1 Test St', 'Ho Chi Minh City', 'Vietnam') RETURNING *`,
  );
  const zones = {};
  for (const [code, seatCodes] of Object.entries(layout)) {
    const { rows: [zone] } = await client.query(
      `INSERT INTO venue_zones (venue_id, name, code) VALUES ($1, $2, $3) RETURNING id`,
      [venue.id, `Zone ${code}`, code],
    );
    zones[code] = { id: zone.id, seats: {} };
    for (const [index, seatCode] of seatCodes.entries()) {
      const { rows: [seat] } = await client.query(
        `INSERT INTO seats (venue_zone_id, row_label, seat_number, seat_code, x, y)
         VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
        [zone.id, code, index + 1, seatCode, index * 10],
      );
      zones[code].seats[seatCode] = seat.id;
    }
  }
  return { ...venue, zones };
}

async function createEvent(client, organizerId) {
  const { rows } = await client.query(
    `INSERT INTO events (organizer_id, title, slug) VALUES ($1, 'Test Concert', $2) RETURNING *`,
    [organizerId, `concert-${uniqueSuffix()}`],
  );
  return rows[0];
}

async function createSchedule(client, { eventId, venueId, daysFromNow }) {
  const startAt = new Date(Date.now() + daysFromNow * DAY_MS);
  const endAt = new Date(startAt.getTime() + 2 * HOUR_MS);
  const salesStartAt = new Date(Date.now() - DAY_MS);
  const { rows } = await client.query(
    `INSERT INTO event_schedules (event_id, venue_id, start_at, end_at, sales_start_at, sales_end_at)
     VALUES ($1, $2, $3, $4, $5, $3) RETURNING *`,
    [eventId, venueId, startAt, endAt, salesStartAt],
  );
  return rows[0];
}

async function createTicketType(client, { scheduleId, zoneId, code, price = DEFAULT_PRICE }) {
  const { rows } = await client.query(
    `INSERT INTO ticket_types (schedule_id, venue_zone_id, name, code, price)
     VALUES ($1, $2, $3, $3, $4) RETURNING *`,
    [scheduleId, zoneId, code, price],
  );
  return rows[0];
}

/**
 * One schedule_seats row per seat of each zone that has a ticket type,
 * priced from that ticket type. Returns { seatCode: scheduleSeatRow }.
 */
async function generateScheduleSeats(client, scheduleId) {
  const { rows } = await client.query(
    `INSERT INTO schedule_seats (schedule_id, seat_id, ticket_type_id, price, currency)
     SELECT tt.schedule_id, s.id, tt.id, tt.price, tt.currency
     FROM ticket_types tt
     JOIN seats s ON s.venue_zone_id = tt.venue_zone_id
     WHERE tt.schedule_id = $1
     RETURNING *`,
    [scheduleId],
  );
  const { rows: codes } = await client.query(
    `SELECT id, seat_code FROM seats WHERE id = ANY($1::uuid[])`,
    [rows.map((row) => row.seat_id)],
  );
  const codeBySeatId = Object.fromEntries(codes.map((seat) => [seat.id, seat.seat_code]));
  return Object.fromEntries(rows.map((row) => [codeBySeatId[row.seat_id], row]));
}

async function createOrder(client, { userId, scheduleId, status = 'HELD', subtotal = 0 }) {
  const { rows } = await client.query(
    `INSERT INTO orders (order_code, user_id, schedule_id, status, subtotal, total_amount, expires_at, paid_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7) RETURNING *`,
    [
      `ORD-${uniqueSuffix().toUpperCase()}`,
      userId,
      scheduleId,
      status,
      subtotal,
      EXPIRING_ORDER_STATUSES.includes(status) ? new Date(Date.now() + HOLD_TTL_MS) : null,
      PAID_ORDER_STATUSES.includes(status) ? new Date() : null,
    ],
  );
  return rows[0];
}

async function createOrderItem(client, { order, eventId, scheduleSeat, seatId = scheduleSeat.seat_id }) {
  const { rows } = await client.query(
    `INSERT INTO order_items (order_id, schedule_seat_id, event_id, schedule_id, seat_id,
                              seat_label, unit_price, quantity, total_amount)
     VALUES ($1, $2, $3, $4, $5, 'A01', $6, 1, $6) RETURNING *`,
    [order.id, scheduleSeat.id, eventId, order.schedule_id, seatId, scheduleSeat.price],
  );
  return rows[0];
}

/**
 * A complete, valid graph:
 * user → organizer → event → venue (zones A, B) → two schedules (S1, S2),
 * each with ticket types and generated schedule_seats.
 */
async function createBookableWorld(client) {
  const customer = await createUser(client);
  const organizer = await createOrganizer(client, (await createUser(client)).id);
  const event = await createEvent(client, organizer.id);
  const venue = await createVenueWithSeats(client, { A: ['A01', 'A02'], B: ['B01'] });

  const schedules = [];
  for (const daysFromNow of [30, 31]) {
    const schedule = await createSchedule(client, { eventId: event.id, venueId: venue.id, daysFromNow });
    for (const [code, zone] of Object.entries(venue.zones)) {
      await createTicketType(client, { scheduleId: schedule.id, zoneId: zone.id, code: `ZONE-${code}` });
    }
    const seats = await generateScheduleSeats(client, schedule.id);
    schedules.push({ ...schedule, seats });
  }

  return { customer, organizer, event, venue, schedules };
}

module.exports = {
  createUser,
  createOrganizer,
  createVenueWithSeats,
  createEvent,
  createSchedule,
  createTicketType,
  generateScheduleSeats,
  createOrder,
  createOrderItem,
  createBookableWorld,
};

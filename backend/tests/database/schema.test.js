const { randomUUID } = require('node:crypto');
const { closePool } = require('../../src/database/pool');
const { PG_ERROR } = require('../../src/database/errors');
const { inRollbackTransaction, expectPgError } = require('../helpers/db');
const {
  createBookableWorld,
  createOrder,
  createOrderItem,
  createOrganizer,
  createUser,
} = require('../helpers/fixtures');

afterAll(() => closePool());

/**
 * These tests talk to PostgreSQL directly, bypassing the application.
 * They prove the DATABASE enforces the business invariants, so a future bug
 * in a service cannot corrupt data.
 */

const INVALID_TEXT_REPRESENTATION = '22P02';
const INSUFFICIENT_PRIVILEGE = '42501';

const inTenMinutes = () => new Date(Date.now() + 10 * 60 * 1000);

/** Update the state columns of one schedule seat (unset columns become NULL). */
const setSeatState = (client, scheduleSeatId, state) =>
  client.query(
    `UPDATE schedule_seats
     SET status = $2, held_by_order_id = $3, hold_expires_at = $4, sold_by_order_id = $5, sold_at = $6
     WHERE id = $1
     RETURNING *`,
    [
      scheduleSeatId,
      state.status,
      state.heldByOrderId ?? null,
      state.holdExpiresAt ?? null,
      state.soldByOrderId ?? null,
      state.soldAt ?? null,
    ],
  );

describe('relationship direction (the 3 reversed FKs of the original export)', () => {
  test('a customer can exist without an organizer profile', () =>
    inRollbackTransaction(async (client) => {
      const user = await createUser(client);
      expect(user.id).toBeDefined();
    }));

  test('an organizer must point to an existing user, and only once per user', () =>
    inRollbackTransaction(async (client) => {
      await expectPgError(client, () => createOrganizer(client, randomUUID()), {
        code: PG_ERROR.FOREIGN_KEY_VIOLATION,
        constraint: 'organizers_user_id_fkey',
      });

      const user = await createUser(client);
      await createOrganizer(client, user.id);
      await expectPgError(client, () => createOrganizer(client, user.id), {
        code: PG_ERROR.UNIQUE_VIOLATION,
        constraint: 'organizers_user_id_key',
      });
    }));

  test('an order item can exist before its ticket; a ticket before its check-in', () =>
    inRollbackTransaction(async (client) => {
      const { customer, event, schedules: [s1] } = await createBookableWorld(client);
      const order = await createOrder(client, { userId: customer.id, scheduleId: s1.id, status: 'PAID' });
      const item = await createOrderItem(client, { order, eventId: event.id, scheduleSeat: s1.seats.A01 });
      expect(item.id).toBeDefined(); // no ticket exists yet, and that is allowed
    }));
});

describe('RBAC seed data', () => {
  test('creates the four roles', () =>
    inRollbackTransaction(async (client) => {
      const { rows } = await client.query('SELECT code FROM roles ORDER BY code');
      expect(rows.map((r) => r.code)).toEqual(['ADMIN', 'CUSTOMER', 'ORGANIZER', 'STAFF']);
    }));

  test('ADMIN has every permission; CUSTOMER cannot approve events', () =>
    inRollbackTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT r.code AS role, array_agg(p.code ORDER BY p.code) AS permissions
         FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
         GROUP BY r.code`,
      );
      const byRole = Object.fromEntries(rows.map((r) => [r.role, r.permissions]));
      const { rows: [{ count }] } = await client.query('SELECT count(*) AS count FROM permissions');

      expect(byRole.ADMIN).toHaveLength(count);
      expect(byRole.CUSTOMER).toContain('booking:create');
      expect(byRole.CUSTOMER).not.toContain('event:approve');
      expect(byRole.STAFF).toEqual(expect.arrayContaining(['checkin:create', 'checkin:read']));
    }));
});

describe('ENUM columns', () => {
  test('reject values outside the enum', () =>
    inRollbackTransaction(async (client) => {
      const user = await createUser(client);
      await expectPgError(
        client,
        () => client.query(`UPDATE users SET status = 'SOLDD' WHERE id = $1`, [user.id]),
        { code: INVALID_TEXT_REPRESENTATION },
      );
    }));
});

describe('schedule_seats — seat availability is per schedule', () => {
  test('the same physical seat can be SOLD in S1 and AVAILABLE in S2', () =>
    inRollbackTransaction(async (client) => {
      const { customer, venue, schedules: [s1, s2] } = await createBookableWorld(client);
      const order = await createOrder(client, { userId: customer.id, scheduleId: s1.id, status: 'PAID' });

      await setSeatState(client, s1.seats.A01.id, { status: 'SOLD', soldByOrderId: order.id, soldAt: new Date() });

      const { rows } = await client.query(
        `SELECT schedule_id, status FROM schedule_seats WHERE seat_id = $1`,
        [venue.zones.A.seats.A01],
      );
      const statusBySchedule = Object.fromEntries(rows.map((r) => [r.schedule_id, r.status]));
      expect(statusBySchedule[s1.id]).toBe('SOLD');
      expect(statusBySchedule[s2.id]).toBe('AVAILABLE');
    }));

  test('a seat cannot appear twice in the same schedule', () =>
    inRollbackTransaction(async (client) => {
      const { venue, schedules: [s1] } = await createBookableWorld(client);
      await expectPgError(
        client,
        () => client.query(
          `INSERT INTO schedule_seats (schedule_id, seat_id, ticket_type_id, price) VALUES ($1, $2, $3, 1000)`,
          [s1.id, venue.zones.A.seats.A01, s1.seats.A01.ticket_type_id],
        ),
        { code: PG_ERROR.UNIQUE_VIOLATION, constraint: 'uq_schedule_seats_schedule_seat' },
      );
    }));

  test('status and owner columns must agree', () =>
    inRollbackTransaction(async (client) => {
      const { customer, schedules: [s1] } = await createBookableWorld(client);
      const seatId = s1.seats.A01.id;
      const orderA = await createOrder(client, { userId: customer.id, scheduleId: s1.id });
      const orderB = await createOrder(client, {
        userId: (await createUser(client)).id, scheduleId: s1.id, status: 'PAID',
      });
      const violation = { code: PG_ERROR.CHECK_VIOLATION, constraint: 'chk_schedule_seats_state' };

      // HELD without an owner
      await expectPgError(client, () => setSeatState(client, seatId, { status: 'HELD' }), violation);
      // HELD by order A and at the same time SOLD to order B
      await expectPgError(
        client,
        () => setSeatState(client, seatId, {
          status: 'HELD', heldByOrderId: orderA.id, holdExpiresAt: inTenMinutes(),
          soldByOrderId: orderB.id, soldAt: new Date(),
        }),
        violation,
      );
      // AVAILABLE but still pointing at an order
      await expectPgError(
        client,
        () => setSeatState(client, seatId, { status: 'AVAILABLE', heldByOrderId: orderA.id }),
        violation,
      );

      const { rows } = await setSeatState(client, seatId, {
        status: 'HELD', heldByOrderId: orderA.id, holdExpiresAt: inTenMinutes(),
      });
      expect(rows[0].status).toBe('HELD');
    }));

  test('an order for another schedule cannot hold the seat', () =>
    inRollbackTransaction(async (client) => {
      const { customer, schedules: [s1, s2] } = await createBookableWorld(client);
      const orderForS2 = await createOrder(client, { userId: customer.id, scheduleId: s2.id });

      await expectPgError(
        client,
        () => setSeatState(client, s1.seats.A01.id, {
          status: 'HELD', heldByOrderId: orderForS2.id, holdExpiresAt: inTenMinutes(),
        }),
        { code: PG_ERROR.FOREIGN_KEY_VIOLATION, constraint: 'schedule_seats_held_by_order_fkey' },
      );
    }));

  test('every UPDATE bumps version (used to order WebSocket events)', () =>
    inRollbackTransaction(async (client) => {
      const { schedules: [s1] } = await createBookableWorld(client);
      const seatId = s1.seats.A01.id;

      const { rows: [blocked] } = await setSeatState(client, seatId, { status: 'BLOCKED' });
      const { rows: [available] } = await setSeatState(client, seatId, { status: 'AVAILABLE' });

      expect(blocked.version).toBe(1);
      expect(available.version).toBe(2);
    }));
});

describe('orders and order_items', () => {
  test('total must equal subtotal minus discount; money is returned as a number', () =>
    inRollbackTransaction(async (client) => {
      const { customer, schedules: [s1] } = await createBookableWorld(client);
      const order = await createOrder(client, { userId: customer.id, scheduleId: s1.id, subtotal: 1_000_000 });
      expect(order.total_amount).toBe(1_000_000);

      await expectPgError(
        client,
        () => client.query(`UPDATE orders SET discount_amount = 100000 WHERE id = $1`, [order.id]),
        { code: PG_ERROR.CHECK_VIOLATION, constraint: 'chk_orders_total' },
      );
      await client.query(
        `UPDATE orders SET discount_amount = 100000, total_amount = 900000 WHERE id = $1`,
        [order.id],
      );
    }));

  test('a HELD order must have an expiry', () =>
    inRollbackTransaction(async (client) => {
      const { customer, schedules: [s1] } = await createBookableWorld(client);
      const order = await createOrder(client, { userId: customer.id, scheduleId: s1.id });
      await expectPgError(
        client,
        () => client.query(`UPDATE orders SET expires_at = NULL WHERE id = $1`, [order.id]),
        { code: PG_ERROR.CHECK_VIOLATION, constraint: 'chk_orders_expiry' },
      );
    }));

  test('a user can have only one active cart per schedule', () =>
    inRollbackTransaction(async (client) => {
      const { customer, schedules: [s1] } = await createBookableWorld(client);
      const first = await createOrder(client, { userId: customer.id, scheduleId: s1.id });

      await expectPgError(
        client,
        () => createOrder(client, { userId: customer.id, scheduleId: s1.id }),
        { code: PG_ERROR.UNIQUE_VIOLATION, constraint: 'uq_orders_active_cart' },
      );

      // Once the first cart expires, a new one is allowed.
      await client.query(`UPDATE orders SET status = 'EXPIRED' WHERE id = $1`, [first.id]);
      await createOrder(client, { userId: customer.id, scheduleId: s1.id });
    }));

  test('a seat appears at most once per order', () =>
    inRollbackTransaction(async (client) => {
      const { customer, event, schedules: [s1] } = await createBookableWorld(client);
      const order = await createOrder(client, { userId: customer.id, scheduleId: s1.id });

      await createOrderItem(client, { order, eventId: event.id, scheduleSeat: s1.seats.A01 });
      await expectPgError(
        client,
        () => createOrderItem(client, { order, eventId: event.id, scheduleSeat: s1.seats.A01 }),
        { code: PG_ERROR.UNIQUE_VIOLATION, constraint: 'order_items_order_id_schedule_seat_id_key' },
      );
    }));

  test('redundant columns cannot disagree with the schedule seat', () =>
    inRollbackTransaction(async (client) => {
      const { customer, event, venue, schedules: [s1] } = await createBookableWorld(client);
      const order = await createOrder(client, { userId: customer.id, scheduleId: s1.id });

      // schedule_seat_id says A01, but seat_id says A02.
      await expectPgError(
        client,
        () => createOrderItem(client, {
          order, eventId: event.id, scheduleSeat: s1.seats.A01, seatId: venue.zones.A.seats.A02,
        }),
        { code: PG_ERROR.FOREIGN_KEY_VIOLATION, constraint: 'order_items_schedule_seat_fkey' },
      );
    }));
});

describe('payments — idempotency at the database level', () => {
  const insertPayment = (client, { order, userId = order.user_id, key, status = 'PENDING' }) =>
    client.query(
      `INSERT INTO payments (order_id, user_id, idempotency_key, request_hash, provider, amount, status, paid_at)
       VALUES ($1, $2, $3, 'hash', 'MOCK', 500000, $4, $5) RETURNING *`,
      [order.id, userId, key, status, status === 'SUCCESS' ? new Date() : null],
    );

  test('the same user cannot create two payments with one idempotency key', () =>
    inRollbackTransaction(async (client) => {
      const { customer, schedules: [s1] } = await createBookableWorld(client);
      const order = await createOrder(client, { userId: customer.id, scheduleId: s1.id });
      const key = randomUUID();

      await insertPayment(client, { order, key, status: 'FAILED' });
      await expectPgError(client, () => insertPayment(client, { order, key }), {
        code: PG_ERROR.UNIQUE_VIOLATION,
        constraint: 'uq_payments_user_idempotency_key',
      });
    }));

  test('two different users may use the same key value independently', () =>
    inRollbackTransaction(async (client) => {
      const { customer, schedules: [s1] } = await createBookableWorld(client);
      const other = await createUser(client);
      const key = 'shared-key-123';

      await insertPayment(client, { order: await createOrder(client, { userId: customer.id, scheduleId: s1.id }), key });
      await insertPayment(client, { order: await createOrder(client, { userId: other.id, scheduleId: s1.id }), key });
    }));

  test('one in-flight payment per order, but a retry after failure is allowed', () =>
    inRollbackTransaction(async (client) => {
      const { customer, schedules: [s1] } = await createBookableWorld(client);
      const order = await createOrder(client, { userId: customer.id, scheduleId: s1.id });

      await insertPayment(client, { order, key: randomUUID(), status: 'FAILED' });
      await insertPayment(client, { order, key: randomUUID() });
      await expectPgError(client, () => insertPayment(client, { order, key: randomUUID() }), {
        code: PG_ERROR.UNIQUE_VIOLATION,
        constraint: 'uq_payments_order_active',
      });
    }));

  test('a user cannot pay for someone else\'s order', () =>
    inRollbackTransaction(async (client) => {
      const { customer, schedules: [s1] } = await createBookableWorld(client);
      const stranger = await createUser(client);
      const order = await createOrder(client, { userId: customer.id, scheduleId: s1.id });

      await expectPgError(
        client,
        () => insertPayment(client, { order, userId: stranger.id, key: randomUUID() }),
        { code: PG_ERROR.FOREIGN_KEY_VIOLATION, constraint: 'payments_order_user_fkey' },
      );
    }));
});

describe('tickets and check-ins — last line of defence', () => {
  async function issueTicket(client, { order, item }, status = 'VALID') {
    const { rows } = await client.query(
      `INSERT INTO tickets (ticket_code, qr_token_hash, order_id, order_item_id, user_id,
                            event_id, schedule_id, schedule_seat_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        `TKT-${randomUUID().slice(0, 8)}`, randomUUID(), order.id, item.id, order.user_id,
        item.event_id, item.schedule_id, item.schedule_seat_id, status,
      ],
    );
    return rows[0];
  }

  async function paidOrderWithItem(client, world, userId) {
    const [s1] = world.schedules;
    const order = await createOrder(client, { userId, scheduleId: s1.id, status: 'PAID' });
    const item = await createOrderItem(client, { order, eventId: world.event.id, scheduleSeat: s1.seats.A01 });
    return { order, item };
  }

  test('two live tickets can never exist for the same seat of a schedule', () =>
    inRollbackTransaction(async (client) => {
      const world = await createBookableWorld(client);
      const first = await paidOrderWithItem(client, world, world.customer.id);
      const second = await paidOrderWithItem(client, world, (await createUser(client)).id);

      const ticket = await issueTicket(client, first);
      await expectPgError(client, () => issueTicket(client, second), {
        code: PG_ERROR.UNIQUE_VIOLATION,
        constraint: 'uq_tickets_live_seat',
      });

      // After a refund the seat may be sold again.
      await client.query(`UPDATE tickets SET status = 'REFUNDED' WHERE id = $1`, [ticket.id]);
      await issueTicket(client, second);
    }));

  test('re-issuing a ticket for the same order item is a no-op with ON CONFLICT', () =>
    inRollbackTransaction(async (client) => {
      const world = await createBookableWorld(client);
      const paid = await paidOrderWithItem(client, world, world.customer.id);
      await issueTicket(client, paid);

      const { rowCount } = await client.query(
        `INSERT INTO tickets (ticket_code, qr_token_hash, order_id, order_item_id, user_id,
                              event_id, schedule_id, schedule_seat_id)
         SELECT 'TKT-RETRY', 'retry-hash', order_id, id, $2, event_id, schedule_id, schedule_seat_id
         FROM order_items WHERE id = $1
         ON CONFLICT (order_item_id, admission_no) DO NOTHING`,
        [paid.item.id, paid.order.user_id],
      );
      expect(rowCount).toBe(0);
    }));

  test('a ticket can be checked in only once', () =>
    inRollbackTransaction(async (client) => {
      const world = await createBookableWorld(client);
      const staff = await createUser(client);
      const ticket = await issueTicket(client, await paidOrderWithItem(client, world, world.customer.id));
      const checkIn = () => client.query(
        `INSERT INTO check_ins (ticket_id, event_id, schedule_id, staff_user_id) VALUES ($1, $2, $3, $4)`,
        [ticket.id, ticket.event_id, ticket.schedule_id, staff.id],
      );

      await checkIn();
      await expectPgError(client, checkIn, {
        code: PG_ERROR.UNIQUE_VIOLATION,
        constraint: 'check_ins_ticket_id_key',
      });
    }));
});

describe('promotions and audit log', () => {
  test('used_count can never exceed usage_limit', () =>
    inRollbackTransaction(async (client) => {
      const { rows: [promotion] } = await client.query(
        `INSERT INTO promotions (code, name, discount_type, discount_value, usage_limit, starts_at, expires_at)
         VALUES ('SALE10', 'Sale 10%', 'PERCENTAGE', 10, 1, now(), now() + interval '1 day') RETURNING *`,
      );
      const redeem = () =>
        client.query(`UPDATE promotions SET used_count = used_count + 1 WHERE id = $1`, [promotion.id]);

      await redeem();
      await expectPgError(client, redeem, {
        code: PG_ERROR.CHECK_VIOLATION,
        constraint: 'chk_promotions_used_count',
      });
    }));

  test('audit_logs is append-only', () =>
    inRollbackTransaction(async (client) => {
      const { rows: [log] } = await client.query(
        `INSERT INTO audit_logs (action, entity_type) VALUES ('EVENT_APPROVED', 'event') RETURNING id`,
      );
      await expectPgError(
        client,
        () => client.query(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = $1`, [log.id]),
        { code: INSUFFICIENT_PRIVILEGE },
      );
      await expectPgError(
        client,
        () => client.query(`DELETE FROM audit_logs WHERE id = $1`, [log.id]),
        { code: INSUFFICIENT_PRIVILEGE },
      );
    }));
});

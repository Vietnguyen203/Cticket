const request = require('supertest');
const { pool, query, closePool } = require('../../src/database/pool');
const { redis } = require('../../src/redis/client');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, makeDue } = require('../helpers/orders');
const { startServer, connect } = require('../helpers/ws');
const { findInventoryMismatches } = require('../../src/modules/orders');

/**
 * BKG-02: changing the seats / standing tickets of a HELD order.
 * See docs/bkg-02-edit-held-order-design.md.
 */
const mailbox = useFakeMailbox();

let server; // REST + /ws on a real port, for the live seat map checks
let app;
let admin;
let organizer;
let category;
const clients = [];

beforeAll(async () => {
  server = await startServer();
  app = server.app;
  admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  category = await createCategory(app, admin.token);
});
afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  // Every test ends with stock that matches the orders exactly.
  expect(await findInventoryMismatches(pool)).toEqual([]);
});
afterAll(async () => {
  await server.stop();
  await closePool();
});

/** A PUBLISHED event: CAT1 = seats A01..A10 (2.000.000đ), CAT2 = B01..B10 (1.000.000đ), STAND = 100 GA (500.000đ). */
async function onSale(options = {}) {
  const world = await createConfiguredEvent(app, {
    adminToken: admin.token,
    organizerToken: organizer.token,
    categoryId: category.id,
    ...options,
  });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

async function heldOrder(body, options) {
  const world = await onSale(options);
  const [buyer] = await createCustomers(1);
  const { order } = (await book(app, buyer.token, world.schedule.id, body(world)).expect(201)).body.data;
  return { ...world, buyer, order };
}

const edit = (token, orderId, body) => request(app).put(`/api/v1/orders/${orderId}/items`).set(bearer(token)).send(body);
const removeSeat = (token, orderId, seatId) =>
  request(app).delete(`/api/v1/orders/${orderId}/seats/${seatId}`).set(bearer(token));
const checkout = (token, orderId) => request(app).post(`/api/v1/orders/${orderId}/checkout`).set(bearer(token)).send({});

const seatRow = async (scheduleId, seatId) =>
  (
    await query(
      `SELECT s.status, s.held_by_order_id, s.version, s.hold_expires_at = o.expires_at AS same_deadline
       FROM schedule_seats s LEFT JOIN orders o ON o.id = s.held_by_order_id
       WHERE s.schedule_id = $1 AND s.seat_id = $2`,
      [scheduleId, seatId],
    )
  ).rows[0];
const heldGa = async (ticketTypeId) =>
  (await query(`SELECT held_quantity FROM ga_inventory WHERE ticket_type_id = $1`, [ticketTypeId])).rows[0].held_quantity;
const labels = (order) => order.items.map((item) => item.seatLabel ?? `${item.ticketTypeName} x${item.quantity}`);

async function open(token) {
  const client = await connect(server.url);
  clients.push(client);
  await client.waitFor('WELCOME');
  if (token) {
    client.send({ type: 'AUTH', token });
    await client.waitFor('AUTH_OK');
  }
  return client;
}

describe('changing a held order', () => {
  test('add, take out and swap seats: totals follow, the deadline never moves', async () => {
    const { buyer, order, schedule, seat } = await heldOrder((w) => ({ seatIds: [w.seat.A01] }));

    const added = (await edit(buyer.token, order.id, { seatIds: [seat.A01, seat.B05] }).expect(200)).body.data.order;
    expect(labels(added)).toEqual(['Khu A - A01', 'Khu A - B05']);
    expect(added).toMatchObject({ status: 'HELD', subtotal: 3_000_000, totalAmount: 3_000_000, expiresAt: order.expiresAt });
    expect(await seatRow(schedule.id, seat.B05)).toMatchObject({ status: 'HELD', held_by_order_id: order.id, same_deadline: true });

    // Swap: A01 out, B06 in, B05 kept, in one request.
    const swapped = (await edit(buyer.token, order.id, { seatIds: [seat.B05, seat.B06] }).expect(200)).body.data.order;
    expect(labels(swapped)).toEqual(['Khu A - B05', 'Khu A - B06']);
    expect(swapped).toMatchObject({ subtotal: 2_000_000, expiresAt: order.expiresAt });
    expect(await seatRow(schedule.id, seat.A01)).toMatchObject({ status: 'AVAILABLE', held_by_order_id: null });
  });

  test('a seat taken out can be held by someone else at once (its Redis "taken" hint is dropped)', async () => {
    const { buyer, order, schedule, seat } = await heldOrder((w) => ({ seatIds: [w.seat.A01, w.seat.A02] }));
    const [other] = await createCustomers(1);
    // Refused by PostgreSQL: from now on the hint answers for A01 for a few seconds.
    expect((await book(app, other.token, schedule.id, { seatIds: [seat.A01] })).status).toBe(409);
    expect(await redis.get(`seat-taken:${schedule.id}:${seat.A01}`)).toBe('HELD');

    await edit(buyer.token, order.id, { seatIds: [seat.A02] }).expect(200);
    expect(await redis.get(`seat-taken:${schedule.id}:${seat.A01}`)).toBeNull();
    await book(app, other.token, schedule.id, { seatIds: [seat.A01] }).expect(201);
  });

  test('standing tickets: added, raised, lowered and removed, at the price of the line', async () => {
    const { buyer, order, seat, standing } = await heldOrder((w) => ({ seatIds: [w.seat.A01] }));
    const withGa = (quantity) => ({ seatIds: [seat.A01], items: [{ ticketTypeId: standing.id, quantity }] });

    let changed = (await edit(buyer.token, order.id, withGa(3)).expect(200)).body.data.order;
    expect(labels(changed)).toEqual(['Khu A - A01', 'Standing x3']);
    expect(changed.subtotal).toBe(2_000_000 + 3 * 500_000);
    expect(await heldGa(standing.id)).toBe(3);

    // A price change does not touch the line already held.
    await query(`UPDATE ticket_types SET price = 900000 WHERE id = $1`, [standing.id]);
    changed = (await edit(buyer.token, order.id, withGa(5)).expect(200)).body.data.order;
    expect(changed.items[1]).toMatchObject({ quantity: 5, unitPrice: 500_000, totalAmount: 2_500_000 });
    expect(await heldGa(standing.id)).toBe(5);

    changed = (await edit(buyer.token, order.id, withGa(1)).expect(200)).body.data.order;
    expect(changed.subtotal).toBe(2_500_000);
    expect(await heldGa(standing.id)).toBe(1);

    changed = (await edit(buyer.token, order.id, { seatIds: [seat.A01] }).expect(200)).body.data.order;
    expect(labels(changed)).toEqual(['Khu A - A01']);
    expect(await heldGa(standing.id)).toBe(0);
  });

  test('sending the same content twice changes nothing the second time', async () => {
    const { buyer, order, schedule, seat } = await heldOrder((w) => ({ seatIds: [w.seat.A01] }));
    const body = { seatIds: [seat.A01, seat.A02] };
    const first = (await edit(buyer.token, order.id, body).expect(200)).body.data.order;
    const version = (await seatRow(schedule.id, seat.A02)).version;

    const second = (await edit(buyer.token, order.id, body).expect(200)).body.data.order;
    expect(second.items).toEqual(first.items);
    expect((await seatRow(schedule.id, seat.A02)).version).toBe(version);
  });

  test('DELETE one seat (BKG-02 as in the requirements sheet)', async () => {
    const { buyer, order, seat, standing } = await heldOrder((w) => ({
      seatIds: [w.seat.A01, w.seat.A02],
      items: [{ ticketTypeId: w.standing.id, quantity: 1 }],
    }));

    const left = (await removeSeat(buyer.token, order.id, seat.A01).expect(200)).body.data.order;
    expect(labels(left)).toEqual(['Khu A - A02', 'Standing x1']);
    expect((await removeSeat(buyer.token, order.id, seat.A01)).status).toBe(404); // not in the order any more
    await removeSeat(buyer.token, order.id, seat.A02).expect(200);
    expect(await heldGa(standing.id)).toBe(1); // standing tickets untouched

    const single = await heldOrder((w) => ({ seatIds: [w.seat.A03] }));
    const last = await removeSeat(single.buyer.token, single.order.id, single.seat.A03);
    expect(last.status).toBe(422);
    expect(last.body.error.code).toBe('ORDER_CANNOT_BE_EMPTY');
  });

  test('live seat maps see the change, and the buyer’s other tabs hear ORDER_UPDATED', async () => {
    const { buyer, order, schedule, seat, standing } = await heldOrder((w) => ({ seatIds: [w.seat.A01] }));
    const viewer = await open();
    viewer.send({ type: 'SUBSCRIBE', scheduleId: schedule.id });
    await viewer.waitFor('SUBSCRIBED');
    const owner = await open(buyer.token);

    await edit(buyer.token, order.id, { seatIds: [seat.A02], items: [{ ticketTypeId: standing.id, quantity: 2 }] }).expect(200);
    expect((await viewer.waitFor('SEAT_RELEASED')).seats).toEqual([{ seatId: seat.A01, status: 'AVAILABLE', version: expect.any(Number) }]);
    expect((await viewer.waitFor('SEAT_HELD')).seats).toEqual([{ seatId: seat.A02, status: 'HELD', version: expect.any(Number) }]);
    expect((await viewer.waitFor('INVENTORY_UPDATED')).ticketTypes).toEqual([{ ticketTypeId: standing.id, available: 98 }]);
    expect(await owner.waitFor('ORDER_UPDATED')).toEqual({ type: 'ORDER_UPDATED', orderId: order.id });
  });
});

describe('rules', () => {
  test('at most 8 tickets in all, and max_per_order of the types being added to', async () => {
    const { buyer, order, seat, standing, cat1 } = await heldOrder((w) => ({ seatIds: [w.seat.A01] }), { cat1MaxPerOrder: 2 });

    const nine = await edit(buyer.token, order.id, {
      seatIds: [seat.B01, seat.B02, seat.B03, seat.B04, seat.B05, seat.B06, seat.B07, seat.B08],
      items: [{ ticketTypeId: standing.id, quantity: 1 }],
    });
    expect(nine.status).toBe(422);
    expect(nine.body.error.code).toBe('ORDER_LIMIT_EXCEEDED');

    const threeCat1 = await edit(buyer.token, order.id, { seatIds: [seat.A01, seat.A02, seat.A03] });
    expect(threeCat1.body.error.code).toBe('ORDER_LIMIT_EXCEEDED');
    await edit(buyer.token, order.id, { seatIds: [seat.A01, seat.A02] }).expect(200);

    // The limit lowered below what the order already holds: keeping or taking out is still fine.
    await query(`UPDATE ticket_types SET max_per_order = 1 WHERE id = $1`, [cat1.id]);
    await edit(buyer.token, order.id, { seatIds: [seat.A01, seat.A02, seat.B01] }).expect(200);

    expect((await edit(buyer.token, order.id, {})).status).toBe(400);
  });

  test('only the buyer, and only while the order is HELD', async () => {
    const { buyer, order, seat } = await heldOrder((w) => ({ seatIds: [w.seat.A01] }));
    const [stranger] = await createCustomers(1);
    expect((await edit(stranger.token, order.id, { seatIds: [seat.A02] })).status).toBe(404);
    expect((await removeSeat(stranger.token, order.id, seat.A01)).status).toBe(404);
    expect((await edit(admin.token, order.id, { seatIds: [seat.A02] })).status).toBe(404); // admins cancel or refund, never edit

    await checkout(buyer.token, order.id).expect(200);
    const afterCheckout = await edit(buyer.token, order.id, { seatIds: [seat.A01, seat.A02] });
    expect(afterCheckout.status).toBe(409);
    expect(afterCheckout.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  test('a hold past its time is expired by the edit, which reports ORDER_EXPIRED', async () => {
    const { buyer, order, schedule, seat } = await heldOrder((w) => ({ seatIds: [w.seat.A01] }));
    await makeDue(order.id);

    const res = await edit(buyer.token, order.id, { seatIds: [seat.A01, seat.A02] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_EXPIRED');
    expect(await seatRow(schedule.id, seat.A01)).toMatchObject({ status: 'AVAILABLE' });
    expect(await seatRow(schedule.id, seat.A02)).toMatchObject({ status: 'AVAILABLE' });
    expect((await edit(buyer.token, order.id, { seatIds: [seat.A01] })).body.error.code).toBe('ORDER_EXPIRED');
  });

  test('seats taken by others or unknown are refused, and the order is left as it was', async () => {
    const { buyer, order, schedule, seat } = await heldOrder((w) => ({ seatIds: [w.seat.A01] }));
    const [other] = await createCustomers(1);
    await book(app, other.token, schedule.id, { seatIds: [seat.A05] }).expect(201);

    const taken = await edit(buyer.token, order.id, { seatIds: [seat.A02, seat.A05] });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ code: 'SEATS_UNAVAILABLE', details: [{ seatId: seat.A05, status: 'HELD' }] });

    const unknown = await edit(buyer.token, order.id, { seatIds: [seat.A01, order.id] });
    expect(unknown.body.error.details).toEqual([{ seatId: order.id, status: 'NOT_IN_INVENTORY' }]);

    expect(await seatRow(schedule.id, seat.A01)).toMatchObject({ status: 'HELD', held_by_order_id: order.id });
    expect(await seatRow(schedule.id, seat.A02)).toMatchObject({ status: 'AVAILABLE' });
  });

  test('sales closed or a paused ticket type: tickets can be taken out, not added', async () => {
    const { buyer, order, schedule, seat, cat1 } = await heldOrder((w) => ({ seatIds: [w.seat.A01, w.seat.B01] }));

    await request(app).patch(`/api/v1/ticket-types/${cat1.id}`).set(bearer(organizer.token)).send({ status: 'INACTIVE' }).expect(200);
    expect((await edit(buyer.token, order.id, { seatIds: [seat.A01, seat.A02, seat.B01] })).body.error.code).toBe(
      'TICKET_TYPE_UNAVAILABLE',
    );
    await edit(buyer.token, order.id, { seatIds: [seat.A01, seat.B01, seat.B02] }).expect(200); // the A01 it already holds stays

    await query(
      `UPDATE event_schedules SET sales_start_at = now() - interval '2 days', sales_end_at = now() - interval '1 day'
       WHERE id = $1`,
      [schedule.id],
    );
    expect((await edit(buyer.token, order.id, { seatIds: [seat.A01, seat.B01, seat.B02, seat.B03] })).body.error.code).toBe(
      'SALES_CLOSED',
    );
    await removeSeat(buyer.token, order.id, seat.A01).expect(200);
  });
});

describe('concurrency: PostgreSQL decides', () => {
  async function twentyCustomersAddOneSeat() {
    const { schedule, seat, standing } = await onSale();
    const buyers = await createCustomers(20);
    const orders = [];
    for (const buyer of buyers) {
      const body = { items: [{ ticketTypeId: standing.id, quantity: 1 }] };
      orders.push((await book(app, buyer.token, schedule.id, body).expect(201)).body.data.order);
    }
    const results = await Promise.all(
      buyers.map((buyer, i) =>
        edit(buyer.token, orders[i].id, { seatIds: [seat.A05], items: [{ ticketTypeId: standing.id, quantity: 1 }] }),
      ),
    );
    return {
      won: results.filter((r) => r.status === 200).length,
      refused: results.filter((r) => r.status !== 200),
    };
  }

  test('20 customers add the same seat to their orders at once: exactly one gets it', async () => {
    const { won, refused } = await twentyCustomersAddOneSeat();
    expect(won).toBe(1);
    expect(refused.every((r) => r.status === 409 && r.body.error.code === 'SEATS_UNAVAILABLE')).toBe(true);
  });

  test('the same with Redis down: still exactly one', async () => {
    const lock = jest.spyOn(redis, 'seatLock').mockRejectedValue(new Error('Connection is closed.'));
    const mget = jest.spyOn(redis, 'mget').mockRejectedValue(new Error('Connection is closed.'));
    try {
      const { won, refused } = await twentyCustomersAddOneSeat();
      expect(won).toBe(1);
      expect(refused.every((r) => r.body.error.code === 'SEATS_UNAVAILABLE')).toBe(true);
    } finally {
      lock.mockRestore();
      mget.mockRestore();
    }
  });

  test('an edit racing a checkout: the order is paid for exactly what it holds', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { buyer, order, seat } = await heldOrder((w) => ({ seatIds: [w.seat.A01] }));
      const [edited, checkedOut] = await Promise.all([
        edit(buyer.token, order.id, { seatIds: [seat.A01, seat.A02] }),
        checkout(buyer.token, order.id),
      ]);
      expect(checkedOut.status).toBe(200);
      // Either the edit came first (checkout fixed the new total) or it was refused.
      expect([200, 409]).toContain(edited.status);
      const { rows } = await query(
        `SELECT o.status, o.total_amount, (SELECT sum(total_amount) FROM order_items WHERE order_id = o.id)::bigint AS lines
         FROM orders o WHERE o.id = $1`,
        [order.id],
      );
      expect(rows[0].status).toBe('PAYMENT_PENDING');
      expect(Number(rows[0].total_amount)).toBe(Number(rows[0].lines));
      expect(Number(rows[0].total_amount)).toBe(edited.status === 200 ? 4_000_000 : 2_000_000);
    }
  });

  test('two customers swapping seats at the same moment never deadlock', async () => {
    const pairs = [];
    for (let round = 0; round < 10; round += 1) {
      const { schedule, seat } = await onSale();
      const [x, y] = await createCustomers(2);
      const xOrder = (await book(app, x.token, schedule.id, { seatIds: [seat.A01] }).expect(201)).body.data.order;
      const yOrder = (await book(app, y.token, schedule.id, { seatIds: [seat.A02] }).expect(201)).body.data.order;
      pairs.push([edit(x.token, xOrder.id, { seatIds: [seat.A02] }), edit(y.token, yOrder.id, { seatIds: [seat.A01] })]);
    }
    const results = await Promise.all(pairs.flat());
    // Each wants a seat the other still holds: both refused cleanly, never a 500 (deadlock).
    expect(results.map((r) => r.body.error?.code)).toEqual(Array(20).fill('SEATS_UNAVAILABLE'));
  });
});

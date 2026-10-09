const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { useFakeMailbox, createLoggedInUser } = require('../helpers/auth');
const {
  bearer,
  unique,
  at,
  createAdmin,
  createOrganizer,
  createCategory,
  createVenue,
  createEvent,
  addSchedule,
  changeStatus,
  addTicketType,
} = require('../helpers/catalog');

const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizerA;
let organizerB;
let customer;
let category;

beforeAll(async () => {
  admin = await createAdmin(app);
  organizerA = await createOrganizer(app, mailbox, admin.token);
  organizerB = await createOrganizer(app, mailbox, admin.token);
  customer = await createLoggedInUser(app, mailbox);
  category = await createCategory(app, admin.token);
});
afterAll(() => closePool());

const asAdmin = (req) => req.set(bearer(admin.token));

/** A venue with a SEATED zone "A" (rows A and B, 10 seats each) and a STANDING zone "PIT" (100). */
async function createSeatedVenue() {
  const venue = await createVenue(app, admin.token);
  const zoneA = await asAdmin(request(app).post(`/api/v1/venues/${venue.id}/zones`))
    .send({ code: 'A', name: 'Khu A', kind: 'SEATED' })
    .expect(201);
  const pit = await asAdmin(request(app).post(`/api/v1/venues/${venue.id}/zones`))
    .send({ code: 'PIT', name: 'Khu đứng', kind: 'STANDING', capacity: 100 })
    .expect(201);
  await asAdmin(request(app).post(`/api/v1/zones/${zoneA.body.data.zone.id}/seats/bulk`))
    .send({ rows: [{ rowLabel: 'A', from: 1, to: 10 }, { rowLabel: 'B', from: 1, to: 10 }] })
    .expect(201);
  const layout = await request(app).get(`/api/v1/venues/${venue.id}/layout`).expect(200);
  const seats = layout.body.data.zones.find((z) => z.code === 'A').seats;
  return { venue, zoneAId: zoneA.body.data.zone.id, pitId: pit.body.data.zone.id, seats };
}

/**
 * DRAFT event with one schedule configured as: CAT1 (row A, 2.000.000đ),
 * CAT2 (row B, 1.000.000đ) and STANDING (GA 100 in the PIT, 500.000đ).
 */
async function createConfiguredEvent({ daysFromNow = 30 } = {}) {
  const layout = await createSeatedVenue();
  const event = await createEvent(app, organizerA.token, { categoryIds: [category.id] });
  const schedule = (
    await addSchedule(app, organizerA.token, event.id, {
      venueId: layout.venue.id,
      startAt: at(daysFromNow, 12),
      endAt: at(daysFromNow, 14),
    }).expect(201)
  ).body.data.schedule;

  const tt = async (body) => (await addTicketType(app, organizerA.token, schedule.id, body).expect(201)).body.data.ticketType;
  const cat1 = await tt({ code: 'CAT1', name: 'CAT 1', price: 2_000_000, inventoryMode: 'RESERVED' });
  const cat2 = await tt({ code: 'CAT2', name: 'CAT 2', price: 1_000_000, inventoryMode: 'RESERVED' });
  const standing = await tt({
    code: 'STAND', name: 'Standing', price: 500_000, inventoryMode: 'GENERAL_ADMISSION', capacity: 100, venueZoneId: layout.pitId,
  });

  await request(app)
    .put(`/api/v1/schedules/${schedule.id}/seat-plan`)
    .set(bearer(organizerA.token))
    .send({
      assignments: [
        { ticketTypeId: cat1.id, zoneId: layout.zoneAId, rows: ['A'] },
        { ticketTypeId: cat2.id, zoneId: layout.zoneAId, rows: ['B'] },
      ],
    })
    .expect(200);

  return { ...layout, event, schedule, cat1, cat2, standing };
}

async function publish(eventId) {
  await changeStatus(app, organizerA.token, eventId, 'PENDING_APPROVAL').expect(200);
  await changeStatus(app, admin.token, eventId, 'PUBLISHED').expect(200);
}

const availability = (scheduleId, token) => {
  const req = request(app).get(`/api/v1/schedules/${scheduleId}/availability`);
  return token ? req.set(bearer(token)) : req;
};
const block = (scheduleId, body, token = organizerA.token) =>
  request(app).post(`/api/v1/schedules/${scheduleId}/inventory/block`).set(bearer(token)).send(body);

describe('venue layout (admin)', () => {
  test('bulk seat creation generates codes and coordinates in one statement', async () => {
    const { seats } = await createSeatedVenue();
    expect(seats).toHaveLength(20);
    expect(seats[0]).toMatchObject({ code: 'A01', rowLabel: 'A', seatNumber: 1, x: 0, y: 0 });
    expect(seats.find((s) => s.code === 'B10')).toMatchObject({ x: 270, y: 30 });
  });

  test('a duplicate batch fails as a whole: nothing is half-inserted', async () => {
    const { venue, zoneAId } = await createSeatedVenue();
    const res = await asAdmin(request(app).post(`/api/v1/zones/${zoneAId}/seats/bulk`))
      .send({ rows: [{ rowLabel: 'C', from: 1, to: 5 }, { rowLabel: 'A', from: 10, to: 12 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEAT_CODE_TAKEN');

    const layout = await request(app).get(`/api/v1/venues/${venue.id}/layout`);
    expect(layout.body.data.zones.find((z) => z.code === 'A').seats).toHaveLength(20); // row C was rolled back too
  });

  test('zone rules: standing zones need a capacity and cannot hold seats; customers cannot edit layouts', async () => {
    const { venue, pitId } = await createSeatedVenue();

    const noCapacity = await asAdmin(request(app).post(`/api/v1/venues/${venue.id}/zones`))
      .send({ code: 'VIP', name: 'VIP standing', kind: 'STANDING' });
    expect(noCapacity.status).toBe(400);

    const seatsInPit = await asAdmin(request(app).post(`/api/v1/zones/${pitId}/seats/bulk`))
      .send({ rows: [{ rowLabel: 'P', from: 1, to: 5 }] });
    expect(seatsInPit.body.error.code).toBe('ZONE_NOT_SEATED');

    await request(app)
      .post(`/api/v1/venues/${venue.id}/zones`)
      .set(bearer(customer.session.accessToken))
      .send({ code: 'X', name: 'X' })
      .expect(403);
  });

  test('a seat used by a schedule cannot be deleted; an unused one can', async () => {
    const { seats, venue } = await createConfiguredEvent();
    const used = seats.find((s) => s.code === 'A01');
    const res = await asAdmin(request(app).delete(`/api/v1/seats/${used.id}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEAT_IN_USE');

    const zone = await asAdmin(request(app).post(`/api/v1/venues/${venue.id}/zones`)).send({ code: 'Z', name: 'Z' });
    await asAdmin(request(app).post(`/api/v1/zones/${zone.body.data.zone.id}/seats/bulk`)).send({ rows: [{ rowLabel: 'Z', from: 1, to: 1 }] });
    const layout = await request(app).get(`/api/v1/venues/${venue.id}/layout`);
    const unused = layout.body.data.zones.find((z) => z.code === 'Z').seats[0];
    await asAdmin(request(app).delete(`/api/v1/seats/${unused.id}`)).expect(204);
  });
});

describe('ticket types and seat plan (DRAFT configuration)', () => {
  test('mode-specific validation: GA needs a capacity, reserved must not have one', async () => {
    const { schedule } = await createConfiguredEvent();
    const reservedWithCapacity = await addTicketType(app, organizerA.token, schedule.id, {
      code: 'X1', name: 'X', price: 1, inventoryMode: 'RESERVED', capacity: 10,
    });
    expect(reservedWithCapacity.status).toBe(400);
    const gaWithoutCapacity = await addTicketType(app, organizerA.token, schedule.id, {
      code: 'X2', name: 'X', price: 1, inventoryMode: 'GENERAL_ADMISSION',
    });
    expect(gaWithoutCapacity.status).toBe(400);
    const duplicateCode = await addTicketType(app, organizerA.token, schedule.id, {
      code: 'cat1', name: 'X', price: 1, inventoryMode: 'RESERVED',
    });
    expect(duplicateCode.body.error.code).toBe('TICKET_TYPE_CODE_TAKEN');
  });

  test('GA ticket types sold through one standing zone must fit its capacity', async () => {
    const { schedule, pitId } = await createConfiguredEvent(); // STAND already uses 100 / 100
    const res = await addTicketType(app, organizerA.token, schedule.id, {
      code: 'EARLY', name: 'Early bird', price: 300_000, inventoryMode: 'GENERAL_ADMISSION', capacity: 1, venueZoneId: pitId,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('body.capacity');
  });

  test('the seat plan rejects foreign seats, double assignment and GA ticket types', async () => {
    const { schedule, cat1, cat2, standing, zoneAId, seats } = await createConfiguredEvent();
    const other = await createSeatedVenue();
    const put = (assignments) =>
      request(app).put(`/api/v1/schedules/${schedule.id}/seat-plan`).set(bearer(organizerA.token)).send({ assignments });

    const foreign = await put([{ ticketTypeId: cat1.id, seatIds: [other.seats[0].id] }]);
    expect(foreign.body.error.code).toBe('SEAT_PLAN_INVALID');

    const twice = await put([
      { ticketTypeId: cat1.id, seatIds: [seats[0].id] },
      { ticketTypeId: cat2.id, zoneId: zoneAId },
    ]);
    expect(twice.body.error.code).toBe('SEAT_PLAN_INVALID');

    const ga = await put([{ ticketTypeId: standing.id, zoneId: zoneAId }]);
    expect(ga.body.error.code).toBe('SEAT_PLAN_INVALID');

    // The previous valid plan is untouched (each PUT is one transaction).
    const plan = await request(app).get(`/api/v1/schedules/${schedule.id}/seat-plan`).set(bearer(organizerA.token));
    expect(plan.body.data.ticketTypes.map((t) => t.seats)).toEqual([10, 10]);
  });

  test('submitting needs every reserved ticket type to have seats', async () => {
    const { event, schedule } = await createConfiguredEvent();
    await addTicketType(app, organizerA.token, schedule.id, { code: 'VIP', name: 'VIP', price: 9, inventoryMode: 'RESERVED' }).expect(201);
    const res = await changeStatus(app, organizerA.token, event.id, 'PENDING_APPROVAL');
    expect(res.body.error.code).toBe('SEAT_PLAN_INCOMPLETE');
  });

  test('the venue of a schedule cannot change while it has ticket types', async () => {
    const { schedule } = await createConfiguredEvent();
    const otherVenue = await createVenue(app, admin.token);
    const res = await request(app)
      .patch(`/api/v1/schedules/${schedule.id}`)
      .set(bearer(organizerA.token))
      .send({ venueId: otherVenue.id });
    expect(res.body.error.code).toBe('VENUE_CHANGE_BLOCKED');
  });
});

describe('inventory generation on approval', () => {
  test('approval creates reserved seats and GA counters; nothing is on sale before that', async () => {
    const { event, schedule } = await createConfiguredEvent();
    const before = await availability(schedule.id, organizerA.token);
    expect(before.body.error.code).toBe('INVENTORY_NOT_GENERATED');

    await publish(event.id);
    const res = await availability(schedule.id).expect(200);
    const byCode = Object.fromEntries(res.body.data.ticketTypes.map((t) => [t.code, t]));
    expect(byCode.CAT1).toMatchObject({ inventoryMode: 'RESERVED', price: 2_000_000, total: 10, available: 10 });
    expect(byCode.CAT2).toMatchObject({ total: 10, available: 10 });
    expect(byCode.STAND).toMatchObject({ inventoryMode: 'GENERAL_ADMISSION', total: 100, available: 100 });
  });

  test('generation is idempotent: running it again creates nothing', async () => {
    const { event, schedule } = await createConfiguredEvent();
    await publish(event.id);

    const again = await request(app)
      .post(`/api/v1/schedules/${schedule.id}/inventory/generate`)
      .set(bearer(admin.token))
      .expect(200);
    expect(again.body.data.created).toEqual({ reservedSeats: 0, gaTicketTypes: 0 });

    const { rows } = await query(
      `SELECT (SELECT count(*) FROM schedule_seats WHERE schedule_id = $1) AS seats,
              (SELECT count(*) FROM ga_inventory WHERE schedule_id = $1) AS ga`,
      [schedule.id],
    );
    expect(rows[0]).toEqual({ seats: 20, ga: 1 });
  });

  test('the seat map shows reserved seats with prices and GA availability per zone', async () => {
    const { event, schedule } = await createConfiguredEvent();
    await publish(event.id);
    const map = await request(app).get(`/api/v1/schedules/${schedule.id}/seat-map`).expect(200);

    const zoneA = map.body.data.zones.find((z) => z.code === 'A');
    expect(zoneA.seats.find((s) => s.code === 'A01')).toMatchObject({ status: 'AVAILABLE', price: 2_000_000 });
    expect(zoneA.seats.find((s) => s.code === 'B01')).toMatchObject({ status: 'AVAILABLE', price: 1_000_000 });
    const pit = map.body.data.zones.find((z) => z.code === 'PIT');
    expect(pit.generalAdmission).toEqual([expect.objectContaining({ available: 100, total: 100 })]);
  });

  test('after publishing, prices are frozen but sales can be paused', async () => {
    const { event, schedule, cat1 } = await createConfiguredEvent();
    await publish(event.id);

    const price = await request(app).patch(`/api/v1/ticket-types/${cat1.id}`).set(bearer(organizerA.token)).send({ price: 1 });
    expect(price.body.error.code).toBe('EVENT_NOT_EDITABLE');

    await request(app).patch(`/api/v1/ticket-types/${cat1.id}`).set(bearer(organizerA.token)).send({ status: 'INACTIVE' }).expect(200);
    const publicView = await availability(schedule.id);
    expect(publicView.body.data.ticketTypes.map((t) => t.code)).not.toContain('CAT1');
    const ownerView = await availability(schedule.id, organizerA.token);
    expect(ownerView.body.data.ticketTypes.map((t) => t.code)).toContain('CAT1');
  });
});

describe('blocking inventory', () => {
  test('block and unblock seats with a reason; audited; already-blocked seats are reported', async () => {
    const { event, schedule, seats } = await createConfiguredEvent();
    await publish(event.id);
    const [a01, a02] = [seats[0].id, seats[1].id];

    const blocked = await block(schedule.id, { action: 'BLOCK', reason: 'Camera position', seatIds: [a01, a02] }).expect(200);
    expect(blocked.body.data).toEqual({ applied: [a01, a02].sort(), rejected: [] });

    const again = await block(schedule.id, { action: 'BLOCK', reason: 'Camera position', seatIds: [a01] }).expect(200);
    expect(again.body.data).toEqual({ applied: [], rejected: [{ seatId: a01, status: 'BLOCKED' }] });

    const cat1 = (await availability(schedule.id)).body.data.ticketTypes.find((t) => t.code === 'CAT1');
    expect(cat1.available).toBe(8);

    await block(schedule.id, { action: 'UNBLOCK', reason: 'Camera moved', seatIds: [a01] }).expect(200);
    const { rows } = await query(
      `SELECT action FROM audit_logs WHERE entity_type = 'event_schedule' AND entity_id = $1 ORDER BY created_at`,
      [schedule.id],
    );
    expect(rows.map((r) => r.action)).toEqual(['INVENTORY_BLOCKED', 'INVENTORY_UNBLOCKED']); // the no-op wrote nothing
  });

  test('a reason is required, and only the owner or an admin may block', async () => {
    const { event, schedule, seats } = await createConfiguredEvent();
    await publish(event.id);

    expect((await block(schedule.id, { action: 'BLOCK', seatIds: [seats[0].id] })).status).toBe(400);
    expect((await block(schedule.id, { action: 'BLOCK', reason: 'mine', seatIds: [seats[0].id] }, organizerB.token)).status).toBe(404);
    expect((await block(schedule.id, { action: 'BLOCK', reason: 'mine', seatIds: [seats[0].id] }, customer.session.accessToken)).status).toBe(403);
    await block(schedule.id, { action: 'BLOCK', reason: 'Admin hold', seatIds: [seats[0].id] }, admin.token).expect(200);
  });

  test('GA: 10 concurrent blocks of 15 when 70 are available — never over capacity', async () => {
    const { event, schedule, standing } = await createConfiguredEvent();
    await publish(event.id);
    await block(schedule.id, { action: 'BLOCK', reason: 'Sponsors', ticketTypeId: standing.id, quantity: 30 }).expect(200);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        block(schedule.id, { action: 'BLOCK', reason: 'Parallel', ticketTypeId: standing.id, quantity: 15 }),
      ),
    );
    const succeeded = results.filter((r) => r.status === 200).length;
    expect(succeeded).toBe(4); // 4 × 15 = 60 ≤ 70, a fifth would need 75
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'INSUFFICIENT_INVENTORY')).toBe(true);

    const { rows } = await query(`SELECT capacity, blocked_quantity FROM ga_inventory WHERE ticket_type_id = $1`, [standing.id]);
    expect(rows[0]).toEqual({ capacity: 100, blocked_quantity: 90 });
  });
});

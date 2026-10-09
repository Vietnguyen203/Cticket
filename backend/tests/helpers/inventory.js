const request = require('supertest');
const { bearer, at, createVenue, createEvent, addSchedule, addTicketType, changeStatus } = require('./catalog');

/** A venue with a SEATED zone "A" (rows A and B, 10 seats each) and a STANDING zone "PIT" (100). */
async function createSeatedVenue(app, adminToken) {
  const asAdmin = (req) => req.set(bearer(adminToken));
  const venue = await createVenue(app, adminToken);
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
 * `seats` are the physical seats A01..A10, B01..B10 (seat-map ids).
 */
async function createConfiguredEvent(app, { adminToken, organizerToken, categoryId, daysFromNow = 30, cat1MaxPerOrder }) {
  const layout = await createSeatedVenue(app, adminToken);
  const event = await createEvent(app, organizerToken, { categoryIds: [categoryId] });
  const schedule = (
    await addSchedule(app, organizerToken, event.id, {
      venueId: layout.venue.id,
      startAt: at(daysFromNow, 12),
      endAt: at(daysFromNow, 14),
    }).expect(201)
  ).body.data.schedule;

  const tt = async (body) => (await addTicketType(app, organizerToken, schedule.id, body).expect(201)).body.data.ticketType;
  const cat1 = await tt({
    code: 'CAT1', name: 'CAT 1', price: 2_000_000, inventoryMode: 'RESERVED', maxPerOrder: cat1MaxPerOrder,
  });
  const cat2 = await tt({ code: 'CAT2', name: 'CAT 2', price: 1_000_000, inventoryMode: 'RESERVED' });
  const standing = await tt({
    code: 'STAND', name: 'Standing', price: 500_000, inventoryMode: 'GENERAL_ADMISSION', capacity: 100, venueZoneId: layout.pitId,
  });

  await request(app)
    .put(`/api/v1/schedules/${schedule.id}/seat-plan`)
    .set(bearer(organizerToken))
    .send({
      assignments: [
        { ticketTypeId: cat1.id, zoneId: layout.zoneAId, rows: ['A'] },
        { ticketTypeId: cat2.id, zoneId: layout.zoneAId, rows: ['B'] },
      ],
    })
    .expect(200);

  return { ...layout, event, schedule, cat1, cat2, standing };
}

async function publishEvent(app, { adminToken, organizerToken, eventId }) {
  await changeStatus(app, organizerToken, eventId, 'PENDING_APPROVAL').expect(200);
  await changeStatus(app, adminToken, eventId, 'PUBLISHED').expect(200);
}

module.exports = { createSeatedVenue, createConfiguredEvent, publishEvent };

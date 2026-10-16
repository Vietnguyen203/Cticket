const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const mailer = require('../../src/mail/mailer');
const ticketsRepository = require('../../src/modules/tickets/tickets.repository');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book } = require('../helpers/orders');

/** Phase 20: tickets as PDF, in the confirmation email and as downloads. */
const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizer;
let category;

beforeAll(async () => {
  admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  category = await createCategory(app, admin.token);
});
afterAll(() => closePool());

/** A paid order of seats A01 + A02 (2 tickets). */
async function paidOrder() {
  const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  const seat = Object.fromEntries(world.seats.map((s) => [s.code, s.id]));
  const [buyer] = await createCustomers(1);
  const { order } = (await book(app, buyer.token, world.schedule.id, { seatIds: [seat.A01, seat.A02] }).expect(201)).body.data;
  await request(app).post(`/api/v1/orders/${order.id}/checkout`).set(bearer(buyer.token)).send({}).expect(200);
  await request(app).post('/api/v1/payments').set(bearer(buyer.token)).set('Idempotency-Key', randomUUID()).send({ orderId: order.id }).expect(201);
  const email = (await query(`SELECT email FROM users WHERE id = $1`, [buyer.id])).rows[0].email;
  const tickets = (await query(`SELECT id, ticket_code FROM tickets WHERE order_id = $1 ORDER BY ticket_code`, [order.id])).rows;
  return { ...world, buyer: { ...buyer, email }, order, tickets };
}

const mailsTo = (email) => mailer.sendMail.mock.calls.map(([message]) => message).filter((m) => m.to === email);
/** supertest gives binary bodies as Buffers with this parser. */
const binary = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};
const download = (token, url) => request(app).get(url).set(bearer(token)).buffer(true).parse(binary);

describe('the confirmation email', () => {
  test('carries the tickets as a PDF, one page each', async () => {
    const { buyer, order } = await paidOrder();
    const [confirmation] = mailsTo(buyer.email).filter((m) => m.subject.startsWith('Xác nhận đơn'));
    expect(confirmation.attachments).toEqual([
      expect.objectContaining({ filename: `Ve-${order.orderCode}.pdf`, contentType: 'application/pdf' }),
    ]);
    const pdf = confirmation.attachments[0].content;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(confirmation.text).toContain('đính kèm trong email này (PDF');
  });

  test('goes out without the PDF when it cannot be made', async () => {
    const failing = jest.spyOn(ticketsRepository, 'pdfTickets').mockRejectedValue(new Error('disk on fire'));
    try {
      const { buyer } = await paidOrder();
      const [confirmation] = mailsTo(buyer.email).filter((m) => m.subject.startsWith('Xác nhận đơn'));
      expect(confirmation.attachments).toEqual([]);
    } finally {
      failing.mockRestore();
    }
  });
});

describe('downloads', () => {
  test('the order’s PDF and one ticket’s PDF, for their owner only; nothing once refunded', async () => {
    const { buyer, order, tickets } = await paidOrder();
    const all = await download(buyer.token, `/api/v1/orders/${order.id}/tickets.pdf`).expect(200);
    expect(all.headers['content-type']).toBe('application/pdf');
    expect(all.headers['content-disposition']).toBe(`attachment; filename="Ve-${order.orderCode}.pdf"`);
    expect(all.headers['cache-control']).toBe('no-store');
    expect(all.body.subarray(0, 5).toString()).toBe('%PDF-');

    const one = await download(buyer.token, `/api/v1/tickets/${tickets[0].id}/ticket.pdf`).expect(200);
    expect(one.headers['content-disposition']).toBe(`attachment; filename="Ve-${tickets[0].ticket_code}.pdf"`);
    expect(one.body.length).toBeLessThan(all.body.length);

    const [stranger] = await createCustomers(1);
    await download(stranger.token, `/api/v1/orders/${order.id}/tickets.pdf`).expect(404);
    await download(stranger.token, `/api/v1/tickets/${tickets[0].id}/ticket.pdf`).expect(404);

    const { rows } = await query(`SELECT id FROM payments WHERE order_id = $1`, [order.id]);
    await request(app).post(`/api/v1/payments/${rows[0].id}/refund`).set(bearer(admin.token)).send({ reason: 'Test' }).expect(200);
    const refused = await request(app).get(`/api/v1/orders/${order.id}/tickets.pdf`).set(bearer(buyer.token)).expect(409);
    expect(refused.body.error.code).toBe('TICKET_NOT_VALID');
  });

  test('a re-issued QR: the customer is emailed the new PDF', async () => {
    const { buyer, tickets } = await paidOrder();
    await request(app).post(`/api/v1/admin/tickets/${tickets[0].id}/reissue-qr`).set(bearer(admin.token)).expect(200);
    const [reissued] = mailsTo(buyer.email).filter((m) => m.subject === `Mã QR mới của vé ${tickets[0].ticket_code}`);
    expect(reissued.text).toContain('Mã QR cũ');
    expect(reissued.attachments).toEqual([expect.objectContaining({ filename: `Ve-${tickets[0].ticket_code}.pdf` })]);
    expect(reissued.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

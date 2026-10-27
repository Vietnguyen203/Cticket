const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book, refundOrder } = require('../helpers/orders');
const reminders = require('../../src/modules/reminders');
const { TERMS_VERSION } = require('../../src/config/constants');

/** Phase 18.2: reminders 24 hours and 2 hours before the show. */
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

const REMINDER = /^Nhắc lịch: /;

/** A buyer with a paid order (seat A01); the show moved to start `startsIn` from now, the order paid `paidAgo` ago. */
async function paidOrder({ startsIn = '23 hours', paidAgo = '3 days' } = {}) {
  const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  const seat = world.seats.find((s) => s.code === 'A01').id;
  const [buyer] = await createCustomers(1);
  const { order } = (await book(app, buyer.token, world.schedule.id, { seatIds: [seat] }).expect(201)).body.data;
  await request(app).post(`/api/v1/orders/${order.id}/checkout`).set(bearer(buyer.token)).send({ termsVersion: TERMS_VERSION }).expect(200);
  await request(app)
    .post('/api/v1/payments')
    .set(bearer(buyer.token))
    .set('Idempotency-Key', randomUUID())
    .send({ orderId: order.id })
    .expect(201);

  await query(
    `UPDATE event_schedules SET start_at = now() + $2::interval, end_at = now() + $2::interval + interval '2 hours',
            sales_end_at = now() + $2::interval - interval '30 minutes',
            sales_start_at = least(sales_start_at, now() - interval '7 days')
     WHERE id = $1`,
    [world.schedule.id, startsIn],
  );
  await query(`UPDATE orders SET paid_at = now() - $2::interval WHERE id = $1`, [order.id, paidAgo]);
  const email = (await query(`SELECT email FROM users WHERE id = $1`, [buyer.id])).rows[0].email;
  return { ...world, buyer: { ...buyer, email }, order };
}

const remindersOf = async (orderId) =>
  (await query(`SELECT kind FROM order_reminders WHERE order_id = $1 ORDER BY kind`, [orderId])).rows.map((r) => r.kind);
const notificationsOf = async (userId) =>
  (await query(`SELECT type, title FROM notifications WHERE user_id = $1 AND type = 'EVENT_REMINDER'`, [userId])).rows;

describe('reminders before the show', () => {
  test('24 hours before: email with the place, the tickets and the gates; in-app notification; never twice', async () => {
    const { buyer, order } = await paidOrder({ startsIn: '23 hours' });
    await Promise.all([reminders.sendDueReminders(), reminders.sendDueReminders()]); // two workers at once
    await reminders.sendDueReminders();

    expect(await remindersOf(order.id)).toEqual(['24H']);
    const subjects = mailbox.subjects(buyer.email).filter((s) => REMINDER.test(s));
    expect(subjects).toEqual([expect.stringContaining('ngày mai')]);
    const text = mailbox.latestText(buyer.email);
    expect(text).toMatch(/Địa điểm: .+, .+, .+\./);
    expect(text).toMatch(/TKT-\w+ — CAT 1, ghế .*A01/);
    expect(text).toContain('Cổng soát vé mở từ');
    expect(await notificationsOf(buyer.id)).toEqual([{ type: 'EVENT_REMINDER', title: 'Ngày mai là buổi diễn của bạn' }]);
  });

  test('2 hours before: only the 2-hour reminder (the 24-hour one is too late by then)', async () => {
    const { buyer, order } = await paidOrder({ startsIn: '90 minutes' });
    await reminders.sendDueReminders();
    expect(await remindersOf(order.id)).toEqual(['2H']);
    expect(mailbox.subjects(buyer.email).filter((s) => REMINDER.test(s))).toEqual([expect.stringContaining('2 giờ')]);
  });

  test('not sent: bought after the reminder time, reminders turned off, order refunded', async () => {
    const late = await paidOrder({ startsIn: '23 hours', paidAgo: '10 minutes' });
    const off = await paidOrder({ startsIn: '23 hours' });
    await request(app).patch('/api/v1/users/me').set(bearer(off.buyer.token)).send({ eventReminders: false }).expect(200);
    const refunded = await paidOrder({ startsIn: '23 hours' });
    const { rows } = await query(`SELECT id FROM payments WHERE order_id = $1`, [refunded.order.id]);
    await refundOrder(rows[0].id);

    await reminders.sendDueReminders();
    for (const world of [late, off, refunded]) {
      expect(await remindersOf(world.order.id)).toEqual([]);
      expect(mailbox.subjects(world.buyer.email).filter((s) => REMINDER.test(s))).toEqual([]);
    }
    const me = await request(app).get('/api/v1/users/me').set(bearer(off.buyer.token)).expect(200);
    expect(me.body.data.user.eventReminders).toBe(false);
  });
});

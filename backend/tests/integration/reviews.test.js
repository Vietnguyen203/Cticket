const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { query, closePool } = require('../../src/database/pool');
const { useFakeMailbox } = require('../helpers/auth');
const { bearer, createAdmin, createOrganizer, createCategory } = require('../helpers/catalog');
const { createConfiguredEvent, publishEvent } = require('../helpers/inventory');
const { createCustomers, book } = require('../helpers/orders');
const reviews = require('../../src/modules/reviews');
const reminders = require('../../src/modules/reminders');

/** Phase 19: event reviews. See docs/phase-19-reviews-design.md. */
const app = createApp();
const mailbox = useFakeMailbox();

let admin;
let organizer;
let otherOrganizer;
let category;

beforeAll(async () => {
  admin = await createAdmin(app);
  organizer = await createOrganizer(app, mailbox, admin.token);
  otherOrganizer = await createOrganizer(app, mailbox, admin.token);
  category = await createCategory(app, admin.token);
});
afterAll(() => closePool());

async function onSale() {
  const world = await createConfiguredEvent(app, { adminToken: admin.token, organizerToken: organizer.token, categoryId: category.id });
  await publishEvent(app, { adminToken: admin.token, organizerToken: organizer.token, eventId: world.event.id });
  return { ...world, seat: Object.fromEntries(world.seats.map((s) => [s.code, s.id])) };
}

/** A buyer of one seat, paid (simulator); `attended` = their ticket was used at the gate. */
async function buyer(world, seatCode, { attended = true } = {}) {
  const [customer] = await createCustomers(1);
  const { order } = (await book(app, customer.token, world.schedule.id, { seatIds: [world.seat[seatCode]] }).expect(201)).body.data;
  await request(app).post(`/api/v1/orders/${order.id}/checkout`).set(bearer(customer.token)).send({}).expect(200);
  await request(app).post('/api/v1/payments').set(bearer(customer.token)).set('Idempotency-Key', randomUUID()).send({ orderId: order.id }).expect(201);
  if (attended) await query(`UPDATE tickets SET status = 'USED', used_at = now() WHERE order_id = $1`, [order.id]);
  const email = (await query(`SELECT email FROM users WHERE id = $1`, [customer.id])).rows[0].email;
  return { ...customer, email, order };
}

/** The show moved: it ended `endedAgo` ago. */
const showEnded = (scheduleId, endedAgo) =>
  query(
    `UPDATE event_schedules SET end_at = now() - $2::interval, start_at = now() - $2::interval - interval '2 hours',
            sales_end_at = now() - $2::interval - interval '3 hours', sales_start_at = now() - $2::interval - interval '30 days'
     WHERE id = $1`,
    [scheduleId, endedAgo],
  );

const save = (token, eventId, body) => request(app).put(`/api/v1/events/${eventId}/reviews/mine`).set(bearer(token)).send(body);
const mine = (token, eventId) => request(app).get(`/api/v1/events/${eventId}/reviews/mine`).set(bearer(token));
const publicList = (slug, qs = '') => request(app).get(`/api/v1/events/${slug}/reviews${qs}`);
const figures = async (eventId) =>
  (await query(`SELECT rating_count, rating_sum FROM events WHERE id = $1`, [eventId])).rows[0];

describe('writing a review', () => {
  test('only after going in; one per person, changed in place; shown with the average and the distribution', async () => {
    const world = await onSale();
    const notYet = await buyer(world, 'A01', { attended: false });
    expect((await mine(notYet.token, world.event.id).expect(200)).body.data).toMatchObject({ canReview: false, reason: 'NOT_ATTENDED' });
    expect((await save(notYet.token, world.event.id, { rating: 5 }).expect(403)).body.error.code).toBe('REVIEW_NOT_ALLOWED');

    const lan = await buyer(world, 'A02');
    const first = await save(lan.token, world.event.id, { rating: 4, comment: '  Âm thanh tốt, chỗ ngồi hơi chật.  ' }).expect(200);
    expect(first.body.data.review).toMatchObject({ rating: 4, comment: 'Âm thanh tốt, chỗ ngồi hơi chật.', status: 'PUBLISHED' });
    await save(lan.token, world.event.id, { rating: 2, comment: 'Đổi ý' }).expect(200);
    await save(lan.token, world.event.id, { rating: 2, comment: 'Đổi ý' }).expect(200); // the same again: nothing changes
    expect(await figures(world.event.id)).toEqual({ rating_count: 1, rating_sum: 2 });

    const minh = await buyer(world, 'A03');
    await save(minh.token, world.event.id, { rating: 5 }).expect(200);

    const list = (await publicList(world.event.slug).expect(200)).body.data;
    expect(list.summary).toEqual({ average: 3.5, count: 2, distribution: { 5: 1, 4: 0, 3: 0, 2: 1, 1: 0 } });
    expect(list.canReply).toBe(false);
    expect(list.reviews.map((r) => r.rating)).toEqual([5, 2]); // newest first
    expect(list.reviews[1]).toMatchObject({ authorName: 'Test B.', attended: true, comment: 'Đổi ý' });
    expect(list.reviews[1].hiddenReason).toBeUndefined();
    expect((await publicList(world.event.slug, '?sort=lowest').expect(200)).body.data.reviews.map((r) => r.rating)).toEqual([2, 5]);
    expect((await publicList(world.event.slug, '?rating=5').expect(200)).body.data.reviews).toHaveLength(1);

    const event = await request(app).get(`/api/v1/events/${world.event.slug}`).expect(200);
    expect(event.body.data.event.rating).toEqual({ average: 3.5, count: 2 });
  });

  test('refused: a link in the comment, a rating outside 1–5; someone else’s review cannot be deleted', async () => {
    const world = await onSale();
    const lan = await buyer(world, 'A01');
    expect((await save(lan.token, world.event.id, { rating: 5, comment: 'Mua vé rẻ tại www.example.com' }).expect(400)).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
    await save(lan.token, world.event.id, { rating: 6 }).expect(400);
    await save(lan.token, world.event.id, { rating: 5 }).expect(200);
    const [stranger] = await createCustomers(1);
    await request(app).delete(`/api/v1/events/${world.event.id}/reviews/mine`).set(bearer(stranger.token)).expect(404);
    await request(app).delete(`/api/v1/events/${world.event.id}/reviews/mine`).set(bearer(lan.token)).expect(200);
    expect(await figures(world.event.id)).toEqual({ rating_count: 0, rating_sum: 0 });
  });

  test('60 days after the show: no more writing or changing, deleting still works', async () => {
    const world = await onSale();
    const lan = await buyer(world, 'A01');
    await save(lan.token, world.event.id, { rating: 3 }).expect(200);
    await showEnded(world.schedule.id, '61 days');
    expect((await mine(lan.token, world.event.id).expect(200)).body.data).toMatchObject({ canReview: false, reason: 'CLOSED' });
    expect((await save(lan.token, world.event.id, { rating: 5 }).expect(409)).body.error.code).toBe('REVIEW_CLOSED');
    await request(app).delete(`/api/v1/events/${world.event.id}/reviews/mine`).set(bearer(lan.token)).expect(200);
  });

  test('10 people reviewing at the same time: the event figures add up', async () => {
    const world = await onSale();
    const people = [];
    for (const code of ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10']) people.push(await buyer(world, code));
    await Promise.all(people.map((p, i) => save(p.token, world.event.id, { rating: (i % 5) + 1 }).expect(200)));
    expect(await figures(world.event.id)).toEqual({ rating_count: 10, rating_sum: 30 });
  });
});

describe('the organizer’s reply and moderation', () => {
  test('the event’s organizer answers (the author is told); others cannot', async () => {
    const world = await onSale();
    const lan = await buyer(world, 'A01');
    const { id } = (await save(lan.token, world.event.id, { rating: 3, comment: 'Vào cổng hơi lâu' }).expect(200)).body.data.review;
    expect((await publicList(world.event.slug).set(bearer(organizer.token)).expect(200)).body.data.canReply).toBe(true);

    await request(app).put(`/api/v1/reviews/${id}/reply`).set(bearer(otherOrganizer.token)).send({ reply: 'Không phải sự kiện của tôi' }).expect(404);
    await request(app).put(`/api/v1/reviews/${id}/reply`).set(bearer(lan.token)).send({ reply: 'Tự trả lời' }).expect(404);
    const res = await request(app).put(`/api/v1/reviews/${id}/reply`).set(bearer(organizer.token)).send({ reply: 'Cảm ơn bạn, lần sau sẽ mở thêm cổng.' }).expect(200);
    expect(res.body.data.review.reply).toMatchObject({ text: 'Cảm ơn bạn, lần sau sẽ mở thêm cổng.' });
    const { rows } = await query(`SELECT type FROM notifications WHERE user_id = $1`, [lan.id]);
    expect(rows.map((r) => r.type)).toContain('REVIEW_REPLIED');

    await request(app).delete(`/api/v1/reviews/${id}/reply`).set(bearer(organizer.token)).expect(200);
    expect((await publicList(world.event.slug).expect(200)).body.data.reviews[0].reply).toBeNull();
  });

  test('an admin hides (reason, audited): out of the average and the list, the author sees why; restoring brings it back', async () => {
    const world = await onSale();
    const lan = await buyer(world, 'A01');
    const minh = await buyer(world, 'A02');
    const { id } = (await save(lan.token, world.event.id, { rating: 1, comment: 'Nội dung xúc phạm' }).expect(200)).body.data.review;
    await save(minh.token, world.event.id, { rating: 5 }).expect(200);

    await request(app).post(`/api/v1/admin/reviews/${id}/hide`).set(bearer(lan.token)).send({ reason: 'Tự ẩn' }).expect(403);
    await request(app).post(`/api/v1/admin/reviews/${id}/hide`).set(bearer(admin.token)).send({ reason: 'Ngôn từ xúc phạm' }).expect(200);
    expect(await figures(world.event.id)).toEqual({ rating_count: 1, rating_sum: 5 });
    expect((await publicList(world.event.slug).expect(200)).body.data.reviews.map((r) => r.id)).not.toContain(id);
    expect((await mine(lan.token, world.event.id).expect(200)).body.data).toMatchObject({
      canReview: false,
      reason: 'HIDDEN',
      review: { status: 'HIDDEN', hiddenReason: 'Ngôn từ xúc phạm' },
    });
    expect((await save(lan.token, world.event.id, { rating: 2 }).expect(409)).body.error.code).toBe('REVIEW_HIDDEN');
    expect((await request(app).put(`/api/v1/reviews/${id}/reply`).set(bearer(organizer.token)).send({ reply: 'Xin lỗi' }).expect(409)).body.error.code).toBe(
      'REVIEW_HIDDEN',
    );
    const listed = await request(app).get('/api/v1/admin/reviews').query({ eventId: world.event.id, status: 'HIDDEN' }).set(bearer(admin.token)).expect(200);
    expect(listed.body.data.reviews).toEqual([expect.objectContaining({ id, hiddenReason: 'Ngôn từ xúc phạm', authorEmail: lan.email })]);

    await request(app).post(`/api/v1/admin/reviews/${id}/unhide`).set(bearer(admin.token)).expect(200);
    expect(await figures(world.event.id)).toEqual({ rating_count: 2, rating_sum: 6 });
    const { rows } = await query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`, [id]);
    expect(rows.map((r) => r.action)).toEqual(['REVIEW_HIDDEN', 'REVIEW_RESTORED']);
  });

  test('the nightly check puts drifted figures right', async () => {
    const world = await onSale();
    const lan = await buyer(world, 'A01');
    await save(lan.token, world.event.id, { rating: 4 }).expect(200);
    await query(`UPDATE events SET rating_count = 3, rating_sum = 3 WHERE id = $1`, [world.event.id]);
    expect((await reviews.reconcileRatings()).fixed).toBeGreaterThanOrEqual(1);
    expect(await figures(world.event.id)).toEqual({ rating_count: 1, rating_sum: 4 });
  });
});

describe('"how was the show?" email', () => {
  test('a day after the show, to people who went in and have not reviewed, once', async () => {
    const world = await onSale();
    const lan = await buyer(world, 'A01');
    const minh = await buyer(world, 'A02');
    const absent = await buyer(world, 'A03', { attended: false });
    await save(minh.token, world.event.id, { rating: 5 }).expect(200); // already reviewed
    await showEnded(world.schedule.id, '25 hours');

    await Promise.all([reminders.sendDueReminders(), reminders.sendDueReminders()]);
    await reminders.sendDueReminders();
    const subject = `Bạn thấy ${world.event.title} thế nào?`;
    expect(mailbox.subjects(lan.email).filter((s) => s === subject)).toHaveLength(1);
    expect(mailbox.subjects(minh.email)).not.toContain(subject);
    expect(mailbox.subjects(absent.email)).not.toContain(subject);
  });
});

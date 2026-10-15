const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { EVENT_STATUS, REVIEW, REVIEW_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { toLimitOffset, toPageMeta } = require('../../utils/pagination');
const { QUEUE, enqueueAfterCommit } = require('../../queue/queues');
const { recordAudit } = require('../audit');
const events = require('../events');
const repository = require('./reviews.repository');

/**
 * Phase 19: event reviews. See docs/phase-19-reviews-design.md.
 * - Only people with a ticket used at the gate may review; one review per
 *   person and event; written / changed until EDIT_DAYS after their show.
 * - Published at once; an admin can hide one (with a reason) and restore it.
 * - Every change locks the event row first and moves its rating_count /
 *   rating_sum (published reviews only) in the same transaction.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const notFound = () => new AppError('NOT_FOUND', 'Review not found.');
const eventNotFound = () => new AppError('NOT_FOUND', 'Event not found.');

const ratingOf = (event) => ({
  average: event.rating_count > 0 ? Math.round((event.rating_sum / event.rating_count) * 10) / 10 : null,
  count: event.rating_count,
});

function toReview(row, { viewerId = null } = {}) {
  const mine = viewerId !== null && row.user_id === viewerId;
  return {
    id: row.id,
    eventId: row.event_id,
    rating: row.rating,
    comment: row.comment,
    status: row.status,
    authorName: row.author_name ?? null,
    attended: true, // only people who went in can write one
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reply: row.organizer_reply ? { text: row.organizer_reply, at: row.organizer_replied_at } : null,
    // The reason is for the author (and admins), never the public.
    ...(mine || row.author_email !== undefined ? { hiddenReason: row.hidden_reason } : {}),
    ...(row.author_email !== undefined
      ? { authorEmail: row.author_email, event: { title: row.event_title, slug: row.event_slug } }
      : {}),
  };
}

/** Published figures move only with published reviews. */
const contribution = (row) => (row?.status === REVIEW_STATUS.PUBLISHED ? { count: 1, sum: row.rating } : { count: 0, sum: 0 });

/** Can this person write / change a review of this event, and until when? */
async function eligibility(db, userId, event) {
  if (event.status === EVENT_STATUS.CANCELLED) return { canReview: false, reason: 'EVENT_CANCELLED' };
  const attended = await repository.attendance(db, { userId, eventId: event.id });
  if (!attended) return { canReview: false, reason: 'NOT_ATTENDED' };
  const until = new Date(new Date(attended.end_at).getTime() + REVIEW.EDIT_DAYS_AFTER_SHOW * DAY_MS);
  if (until <= new Date()) return { canReview: false, reason: 'CLOSED', orderId: attended.order_id, editableUntil: until };
  return { canReview: true, orderId: attended.order_id, editableUntil: until };
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** GET /events/:idOrSlug/reviews: the summary and one page (published reviews of a public event). */
async function listForEvent(user, idOrSlug, { sort, rating, page, pageSize }) {
  const event = await repository.findEvent(pool, idOrSlug);
  const actor = await events.resolveActor(user);
  if (!event || !(events.PUBLIC_STATUSES.includes(event.status) || events.canManage(actor, event))) throw eventNotFound();
  const { rows, total } = await repository.listPublished(pool, { eventId: event.id, rating, sort, ...toLimitOffset({ page, pageSize }) });
  return {
    summary: { ...ratingOf(event), distribution: await repository.distribution(pool, event.id) },
    // The event's organizer (and admins) answer from this page.
    canReply: events.canManage(actor, event),
    reviews: rows.map((row) => toReview(row)),
    meta: toPageMeta({ page, pageSize }, total),
  };
}

// ---------------------------------------------------------------------------
// The author
// ---------------------------------------------------------------------------

/** GET /events/:id/reviews/mine: my review (hidden included, with the reason) and whether I may write / change it. */
async function getMine(userId, eventId) {
  const event = await repository.findEvent(pool, eventId);
  if (!event) throw eventNotFound();
  const review = await repository.findMine(pool, { userId, eventId: event.id });
  const { canReview, reason, editableUntil } = await eligibility(pool, userId, event);
  return {
    review: review ? toReview(review, { viewerId: userId }) : null,
    canReview: canReview && review?.status !== REVIEW_STATUS.HIDDEN,
    reason: review?.status === REVIEW_STATUS.HIDDEN ? 'HIDDEN' : (reason ?? null),
    editableUntil: editableUntil ?? null,
  };
}

/** PUT /events/:id/reviews/mine: write or change (sending the same twice changes nothing). */
async function saveMine(context, userId, eventId, { rating, comment }) {
  return withTransaction(async (client) => {
    const event = await repository.lockEvent(client, eventId);
    if (!event) throw eventNotFound();
    const rules = await eligibility(client, userId, event);
    if (!rules.canReview) {
      if (rules.reason === 'CLOSED') throw new AppError('REVIEW_CLOSED');
      if (rules.reason === 'EVENT_CANCELLED') throw new AppError('REVIEW_CLOSED', 'This event was cancelled.');
      throw new AppError('REVIEW_NOT_ALLOWED');
    }
    const before = await repository.findMine(client, { userId, eventId, forUpdate: true });
    if (before?.status === REVIEW_STATUS.HIDDEN) throw new AppError('REVIEW_HIDDEN');
    const after = before
      ? await repository.update(client, before.id, { rating, comment: comment ?? null })
      : await repository.insert(client, { userId, eventId, orderId: rules.orderId, rating, comment: comment ?? null });
    const was = contribution(before);
    const now = contribution(after);
    await repository.adjustRating(client, eventId, { count: now.count - was.count, sum: now.sum - was.sum });
    return toReview(after, { viewerId: userId });
  });
}

/** DELETE /events/:id/reviews/mine (allowed even after the editing deadline). */
async function deleteMine(userId, eventId) {
  await withTransaction(async (client) => {
    if (!(await repository.lockEvent(client, eventId))) throw eventNotFound();
    const review = await repository.findMine(client, { userId, eventId, forUpdate: true });
    if (!review) throw notFound();
    await repository.remove(client, review.id);
    const was = contribution(review);
    await repository.adjustRating(client, eventId, { count: -was.count, sum: -was.sum });
  });
}

// ---------------------------------------------------------------------------
// The organizer's reply
// ---------------------------------------------------------------------------

/** PUT / DELETE /reviews/:id/reply: the event's organizer or an admin; never on a hidden review. */
async function setReply(context, user, reviewId, reply) {
  const actor = await events.resolveActor(user);
  return withTransaction(async (client) => {
    const found = await repository.findById(pool, reviewId);
    if (!found) throw notFound();
    const event = await repository.lockEvent(client, found.event_id);
    if (!events.canManage(actor, event)) throw notFound(); // not theirs: as if it did not exist
    const review = await repository.findById(client, reviewId, { forUpdate: true });
    if (review.status === REVIEW_STATUS.HIDDEN) throw new AppError('REVIEW_HIDDEN');
    const updated = await repository.setReply(client, reviewId, reply);
    if (reply && !review.organizer_reply) {
      enqueueAfterCommit(client, QUEUE.NOTIFICATIONS, 'notify', {
        userId: review.user_id,
        type: 'REVIEW_REPLIED',
        data: { reviewId, eventId: review.event_id },
      });
    }
    return toReview(updated);
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function listForAdmin({ eventId, rating, status, q, page, pageSize }) {
  const { rows, total } = await repository.listForAdmin(pool, { eventId, rating, status, q, ...toLimitOffset({ page, pageSize }) });
  return { reviews: rows.map((row) => toReview(row)), meta: toPageMeta({ page, pageSize }, total) };
}

/** Hide (with a reason) or restore; the event's figures follow; audited. */
function moderate(context, reviewId, { hide, reason = null }) {
  return withTransaction(async (client) => {
    const found = await repository.findById(pool, reviewId);
    if (!found) throw notFound();
    await repository.lockEvent(client, found.event_id);
    const review = await repository.findById(client, reviewId, { forUpdate: true });
    const target = hide ? REVIEW_STATUS.HIDDEN : REVIEW_STATUS.PUBLISHED;
    if (review.status === target) return toReview(review);
    const after = await repository.setStatus(client, reviewId, {
      status: target,
      reason: hide ? reason : null,
      moderatorId: context.userId,
    });
    const delta = hide ? -1 : 1;
    await repository.adjustRating(client, review.event_id, { count: delta, sum: delta * review.rating });
    await recordAudit(client, {
      context,
      action: hide ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED',
      entityType: 'review',
      entityId: reviewId,
      oldValue: { status: review.status },
      newValue: { status: target, reason },
    });
    return toReview(after);
  });
}

/** Maintenance (nightly): figures that drifted from the reviews are recounted. */
async function reconcileRatings() {
  let fixed = 0;
  for (const eventId of await repository.findRatingMismatches(pool)) {
    if (await withTransaction((client) => repository.fixRating(client, eventId))) fixed += 1;
  }
  return { fixed };
}

module.exports = {
  listForEvent,
  getMine,
  saveMine,
  deleteMine,
  setReply,
  listForAdmin,
  moderate,
  reconcileRatings,
  ratingOf,
};

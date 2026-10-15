const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { EVENT_STATUS, SCHEDULE_STATUS, TICKET_TYPE_STATUS, WAITLIST, WAITLIST_STATUS } = require('../../config/constants');
const AppError = require('../../utils/AppError');
const { QUEUE, enqueueAfterCommit } = require('../../queue/queues');
const mailer = require('../../mail/mailer');
const { waitlistOfferEmail } = require('../../mail/templates');
const repository = require('./waitlist.repository');

/**
 * Phase 18.4: waiting for a sold-out ticket type.
 * See docs/phase-18-customer-features-design.md, section 5.
 *
 * - Places are counted, never named: an offer keeps N places of a ticket
 *   type for 30 minutes, whichever seats they are.
 * - The offer job (every minute) counts the free places again, so places
 *   freed anywhere (expiry, cancellation, refund, BKG-02, unblocking…) are
 *   found without a hook in each of those places.
 * - A booking of a ticket type with a waiting list checks it does not take
 *   places kept for someone else (assertCanTake), under a per-type lock.
 */

const MY_LIST_LIMIT = 50;

function toEntry(row) {
  return {
    id: row.id,
    status: row.status,
    quantity: row.quantity,
    position: row.position ?? null,
    offeredAt: row.offered_at,
    offerExpiresAt: row.offer_expires_at,
    createdAt: row.created_at,
    ticketType: { id: row.ticket_type_id, name: row.ticket_type_name },
    schedule: { id: row.schedule_id, startAt: row.start_at, venueName: row.venue_name },
    event: { title: row.event_title, slug: row.event_slug },
  };
}

// ---------------------------------------------------------------------------
// The customer
// ---------------------------------------------------------------------------

/** POST /schedules/:id/waitlist: only for a ticket type without enough places for this person. */
async function join(actor, scheduleId, { ticketTypeId, quantity }) {
  const ticketType = await repository.findTicketTypeForJoin(pool, { scheduleId, ticketTypeId });
  if (!ticketType) throw new AppError('NOT_FOUND', 'Ticket type not found.');
  if (
    ticketType.event_status !== EVENT_STATUS.PUBLISHED ||
    ticketType.schedule_status !== SCHEDULE_STATUS.SCHEDULED ||
    ticketType.status !== TICKET_TYPE_STATUS.ACTIVE ||
    !ticketType.selling
  ) {
    throw new AppError('SALES_CLOSED');
  }
  if (quantity > ticketType.max_per_order) {
    throw new AppError('ORDER_LIMIT_EXCEEDED', `At most ${ticketType.max_per_order} tickets of "${ticketType.name}" per order.`);
  }
  const free = (await repository.freePlaces(pool, [ticketTypeId])).get(ticketTypeId) ?? 0;
  const kept = (await repository.keptForOthers(pool, { ticketTypeIds: [ticketTypeId], userId: actor.userId })).get(ticketTypeId) ?? 0;
  if (free - kept >= quantity) throw new AppError('WAITLIST_NOT_NEEDED');

  const created = await repository.insertEntry(pool, { userId: actor.userId, scheduleId, ticketTypeId, quantity });
  if (!created) throw new AppError('WAITLIST_ALREADY_JOINED');
  return toEntry(await repository.findView(pool, created.id));
}

async function listMine(userId) {
  return (await repository.listForUser(pool, userId, MY_LIST_LIMIT)).map(toEntry);
}

async function leave(userId, id) {
  if (!(await repository.cancelEntry(pool, { id, userId }))) throw new AppError('NOT_FOUND', 'Waiting list entry not found.');
}

// ---------------------------------------------------------------------------
// Bookings (called by the orders module, inside its transaction)
// ---------------------------------------------------------------------------

/**
 * Before holding: are the places this person takes kept for someone else?
 * `wanted`: ticket type id → places this booking adds. Types without a
 * waiting list cost one cheap query and no lock. Then the person's own
 * entries for those types are done (BOOKED).
 * @throws AppError WAITLIST_RESERVED
 */
async function assertCanTake(client, { userId, wanted }) {
  const ids = [...wanted.keys()].filter((id) => wanted.get(id) > 0);
  const listed = await repository.typesWithLiveEntries(client, ids);
  if (listed.length === 0) return;
  await repository.lockTicketTypes(client, listed);
  const free = await repository.freePlaces(client, listed);
  const kept = await repository.keptForOthers(client, { ticketTypeIds: listed, userId });
  const short = listed.filter((id) => (free.get(id) ?? 0) - wanted.get(id) < (kept.get(id) ?? 0));
  if (short.length > 0) {
    throw new AppError('WAITLIST_RESERVED', undefined, { details: short.map((id) => ({ ticketTypeId: id, kept: kept.get(id) })) });
  }
  await repository.markBooked(client, { userId, ticketTypeIds: listed });
}

/** For the availability endpoint: places kept for others, per ticket type of the schedule. */
function keptForOthers(db, { ticketTypeIds, userId }) {
  return repository.keptForOthers(db, { ticketTypeIds, userId });
}

// ---------------------------------------------------------------------------
// The offer job (maintenance, every minute)
// ---------------------------------------------------------------------------

/** One ticket type: expired offers end, then the spare places go to the earliest people that fit. */
function offerTicketType(ticketTypeId) {
  return withTransaction(async (client) => {
    await repository.lockTicketTypes(client, [ticketTypeId]);
    await repository.expireOffers(client, ticketTypeId);
    const free = (await repository.freePlaces(client, [ticketTypeId])).get(ticketTypeId) ?? 0;
    const kept = (await repository.keptForOthers(client, { ticketTypeIds: [ticketTypeId], userId: null })).get(ticketTypeId) ?? 0;
    let spare = free - kept;
    if (spare <= 0) return 0;

    // Earliest first; someone wanting more than what is spare is passed over
    // for now, so one big request never blocks the whole list.
    const chosen = [];
    for (const entry of await repository.waitingOf(client, ticketTypeId)) {
      if (entry.quantity <= spare) {
        chosen.push(entry.id);
        spare -= entry.quantity;
      }
      if (spare === 0) break;
    }
    if (chosen.length === 0) return 0;
    await repository.offer(client, chosen, WAITLIST.OFFER_MINUTES);
    for (const id of chosen) {
      enqueueAfterCommit(client, QUEUE.EMAILS, 'waitlist-offer', { entryId: id }, { jobId: `waitlist-offer-${id}` });
      enqueueAfterCommit(client, QUEUE.NOTIFICATIONS, 'notify-waitlist', { entryId: id });
    }
    return chosen.length;
  });
}

async function offerSpacesToWaitlist() {
  const closed = await repository.closeStopped(pool);
  let offered = 0;
  for (const ticketTypeId of await repository.typesToOffer(pool, WAITLIST.TYPES_PER_RUN)) {
    offered += await offerTicketType(ticketTypeId);
  }
  return { closed, offered };
}

/** Emails queue. Only while the offer runs (booked, expired or cancelled since → nothing). */
async function sendOfferEmail({ entryId }) {
  const row = await repository.findView(pool, entryId);
  if (!row || row.status !== WAITLIST_STATUS.OFFERED) return 'skipped';
  await mailer.sendMail({ to: row.email, ...waitlistOfferEmail(row) });
  return 'sent';
}

/** The in-app notification of an offer (the notifications module saves and pushes it). */
async function offerNotification({ entryId }) {
  const row = await repository.findView(pool, entryId);
  if (!row || row.status !== WAITLIST_STATUS.OFFERED) return null;
  return {
    userId: row.user_id,
    type: 'WAITLIST_OFFER',
    data: {
      entryId,
      scheduleId: row.schedule_id,
      eventTitle: row.event_title,
      eventSlug: row.event_slug,
      ticketTypeName: row.ticket_type_name,
      quantity: row.quantity,
      offerExpiresAt: row.offer_expires_at,
    },
  };
}

module.exports = {
  join,
  listMine,
  leave,
  assertCanTake,
  keptForOthers,
  offerSpacesToWaitlist,
  sendOfferEmail,
  offerNotification,
  toEntry,
};

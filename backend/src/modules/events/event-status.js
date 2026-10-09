const { EVENT_STATUS } = require('../../config/constants');
const { isOwner } = require('./event-access');

const { DRAFT, PENDING_APPROVAL, PUBLISHED, CANCELLED } = EVENT_STATUS;

const ACTOR = Object.freeze({
  OWNER: 'OWNER', // the organizer who owns the event
  APPROVER: 'APPROVER', // admin with event:approve
});

/**
 * The event state machine: every allowed status change, who may make it, and
 * what is required. Anything not listed here is rejected.
 *
 *   DRAFT ──submit──► PENDING_APPROVAL ──approve──► PUBLISHED
 *     ▲                  │
 *     └─reject/withdraw──┘           (DRAFT | PENDING | PUBLISHED) ──cancel──► CANCELLED
 *
 * FINISHED is set by a background job after the last show (Phase 9).
 * Order matters: when one person is both owner and approver, the first
 * matching rule wins (an admin moving PENDING → DRAFT is a rejection).
 */
const TRANSITIONS = [
  {
    from: [DRAFT],
    to: PENDING_APPROVAL,
    by: ACTOR.OWNER,
    action: 'EVENT_SUBMITTED',
    requiresUpcomingSchedule: true,
    requiresSellableConfiguration: true,
  },
  {
    from: [PENDING_APPROVAL],
    to: PUBLISHED,
    by: ACTOR.APPROVER,
    action: 'EVENT_APPROVED',
    requiresSellableConfiguration: true,
    // Schedule inventory is created in the same transaction as the approval.
    generatesInventory: true,
  },
  { from: [PENDING_APPROVAL], to: DRAFT, by: ACTOR.APPROVER, action: 'EVENT_REJECTED', reasonRequired: true },
  { from: [PENDING_APPROVAL], to: DRAFT, by: ACTOR.OWNER, action: 'EVENT_WITHDRAWN' },
  { from: [DRAFT, PENDING_APPROVAL, PUBLISHED], to: CANCELLED, by: ACTOR.APPROVER, action: 'EVENT_CANCELLED', reasonRequired: true },
  { from: [DRAFT, PENDING_APPROVAL, PUBLISHED], to: CANCELLED, by: ACTOR.OWNER, action: 'EVENT_CANCELLED', reasonRequired: true },
];

function actsAs(actor, event, role) {
  return role === ACTOR.APPROVER ? actor.canApprove : isOwner(actor, event);
}

/**
 * @returns {{ ok: true, transition: object } | { ok: false, error: 'INVALID_STATE_TRANSITION'|'FORBIDDEN' }}
 *   INVALID_STATE_TRANSITION: nobody may make this change from the current status.
 *   FORBIDDEN: the change exists, but not for this caller.
 */
function findTransition(actor, event, targetStatus) {
  const candidates = TRANSITIONS.filter((t) => t.from.includes(event.status) && t.to === targetStatus);
  if (candidates.length === 0) {
    return { ok: false, error: 'INVALID_STATE_TRANSITION' };
  }
  const transition = candidates.find((t) => actsAs(actor, event, t.by));
  return transition ? { ok: true, transition } : { ok: false, error: 'FORBIDDEN' };
}

module.exports = { findTransition };

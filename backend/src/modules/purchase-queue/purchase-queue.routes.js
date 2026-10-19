const { Router } = require('express');
const { z } = require('zod');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const { rateLimit, LIMITS } = require('../../middleware/rateLimit');
const controller = require('./purchase-queue.controller');

const idParams = z.object({ id: z.uuid() });

/** Phase 21: the queue is for buyers (booking:create), the ones it lets in to book. */
const buyer = [authenticate, rateLimit(LIMITS.purchaseQueue), authorize('booking:create'), validate({ params: idParams })];
// The event's organizer or an admin (checked in the service, 404 for anyone else).
const manager = [authenticate, authorize.any('event:update:own', 'event:manage:any'), validate({ params: idParams })];

/** Mounted at /api/v1/events: /events/:id/queue. */
const purchaseQueueRouter = Router();
purchaseQueueRouter.post('/:id/queue', ...buyer, controller.join);
purchaseQueueRouter.get('/:id/queue', ...buyer, controller.status);
purchaseQueueRouter.delete('/:id/queue', ...buyer, controller.leave);
purchaseQueueRouter.get('/:id/queue/stats', ...manager, controller.stats);

module.exports = { purchaseQueueRouter };

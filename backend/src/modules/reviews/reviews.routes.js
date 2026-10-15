const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const { rateLimit, LIMITS } = require('../../middleware/rateLimit');
const schemas = require('./reviews.schemas');
const controller = require('./reviews.controller');

/** Phase 19. Mounted at /api/v1/events: an event's reviews, and mine. */
const eventReviewsRouter = Router();
eventReviewsRouter.get(
  '/:idOrSlug/reviews',
  authenticate.optional,
  validate({ params: schemas.idOrSlugParams, query: schemas.listQuery }),
  controller.listForEvent,
);
const author = [authenticate, authorize('review:create')];
eventReviewsRouter.get('/:id/reviews/mine', ...author, validate({ params: schemas.idParams }), controller.getMine);
eventReviewsRouter.put(
  '/:id/reviews/mine',
  ...author,
  rateLimit(LIMITS.review),
  validate({ params: schemas.idParams, body: schemas.saveReview }),
  controller.saveMine,
);
eventReviewsRouter.delete('/:id/reviews/mine', ...author, validate({ params: schemas.idParams }), controller.deleteMine);

/** Mounted at /api/v1/reviews: the organizer's reply (organizer of the event or admin, checked by the service). */
const reviewsRouter = Router();
reviewsRouter.put('/:id/reply', authenticate, validate({ params: schemas.idParams, body: schemas.reply }), controller.reply);
reviewsRouter.delete('/:id/reply', authenticate, validate({ params: schemas.idParams }), controller.deleteReply);

/** Mounted at /api/v1/admin/reviews: moderation. */
const adminReviewsRouter = Router();
const moderator = [authenticate, authorize('review:manage')];
adminReviewsRouter.get('/', ...moderator, validate({ query: schemas.adminListQuery }), controller.listForAdmin);
adminReviewsRouter.post('/:id/hide', ...moderator, validate({ params: schemas.idParams, body: schemas.hide }), controller.hide);
adminReviewsRouter.post('/:id/unhide', ...moderator, validate({ params: schemas.idParams }), controller.unhide);

module.exports = { eventReviewsRouter, reviewsRouter, adminReviewsRouter };

const { Router } = require('express');
const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const twoFactorRoutes = require('./modules/auth/two-factor.routes');
const categoriesRoutes = require('./modules/categories/categories.routes');
const { venuesRouter, zonesRouter, seatsRouter } = require('./modules/venues/venues.routes');
const organizersRoutes = require('./modules/organizers/organizers.routes');
const { eventsRouter, schedulesRouter, ticketTypesRouter, staffRouter } = require('./modules/events/events.routes');
const { ordersRouter, scheduleOrdersRouter } = require('./modules/orders/orders.routes');
const paymentsRoutes = require('./modules/payments/payments.routes');
const promotionsRoutes = require('./modules/promotions/promotions.routes');
const notificationsRoutes = require('./modules/notifications/notifications.routes');
const ticketsRoutes = require('./modules/tickets/tickets.routes');
const uploadsRoutes = require('./modules/uploads/uploads.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const { checkInsRouter, scheduleCheckInsRouter } = require('./modules/checkins/checkins.routes');
const { waitlistRouter, scheduleWaitlistRouter } = require('./modules/waitlist/waitlist.routes');
const { eventReviewsRouter, reviewsRouter, adminReviewsRouter } = require('./modules/reviews/reviews.routes');
const { purchaseQueueRouter } = require('./modules/purchase-queue/purchase-queue.routes');

/** Everything under /api/v1. Each module mounts its own router here. */
const apiRouter = Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/users/me/2fa', twoFactorRoutes); // Phase 15: my two-factor settings
apiRouter.use('/users', usersRoutes);
apiRouter.use('/categories', categoriesRoutes);
apiRouter.use('/venues', venuesRouter);
apiRouter.use('/zones', zonesRouter);
apiRouter.use('/seats', seatsRouter);
apiRouter.use('/organizers', organizersRoutes);
apiRouter.use('/events', eventsRouter);
apiRouter.use('/events', eventReviewsRouter); // Phase 19: /events/:idOrSlug/reviews
apiRouter.use('/events', purchaseQueueRouter); // Phase 21: /events/:id/queue
apiRouter.use('/schedules', schedulesRouter);
apiRouter.use('/schedules', scheduleOrdersRouter); // POST /schedules/:id/orders
apiRouter.use('/ticket-types', ticketTypesRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/orders', paymentsRoutes.cancellationRouter); // Phase 18.3: /orders/:id/cancellation
apiRouter.use('/orders', ticketsRoutes.orderTicketsRouter); // Phase 20: /orders/:id/tickets.pdf
apiRouter.use('/payments', paymentsRoutes);
apiRouter.use('/promotions', promotionsRoutes);
apiRouter.use('/notifications', notificationsRoutes);
apiRouter.use('/tickets', ticketsRoutes);
apiRouter.use('/check-ins', checkInsRouter);
apiRouter.use('/schedules', scheduleCheckInsRouter); // GET /schedules/:id/check-ins, /check-in-stats
apiRouter.use('/staff', staffRouter);
apiRouter.use('/waitlist', waitlistRouter); // Phase 18.4
apiRouter.use('/schedules', scheduleWaitlistRouter); // POST /schedules/:id/waitlist
apiRouter.use('/uploads', uploadsRoutes);
apiRouter.use('/admin/reviews', adminReviewsRouter); // Phase 19
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/reviews', reviewsRouter); // Phase 19: the organizer's reply
apiRouter.use('/reports', reportsRoutes);

module.exports = apiRouter;

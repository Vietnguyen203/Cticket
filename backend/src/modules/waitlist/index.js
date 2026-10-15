/** Public API of the waitlist module (Phase 18.4), for bookings, the seat map and the worker. */
const service = require('./waitlist.service');

module.exports = {
  assertCanTake: service.assertCanTake,
  keptForOthers: service.keptForOthers,
  offerSpacesToWaitlist: service.offerSpacesToWaitlist,
  sendOfferEmail: service.sendOfferEmail,
  offerNotification: service.offerNotification,
};

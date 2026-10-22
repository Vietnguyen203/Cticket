/** Public API of the venues module for other modules. */
const { findUsableVenue, activateVenuesOfEvent } = require('./venues.service');
const venuesRepository = require('./venues.repository');
const { findZone, findPlannableSeats } = require('./venue-layout.service');

module.exports = {
  findUsableVenue,
  activateVenuesOfEvent,
  findZone,
  findPlannableSeats,
  /** The venue row (its capacity bounds a show's total attendance). */
  findVenue: (db, id) => venuesRepository.findById(db, id),
};

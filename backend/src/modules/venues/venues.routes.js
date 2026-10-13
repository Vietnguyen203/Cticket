const { Router } = require('express');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const schemas = require('./venues.schemas');
const layoutSchemas = require('./venue-layout.schemas');
const controller = require('./venues.controller');
const layoutController = require('./venue-layout.controller');

const canManage = [authenticate, authorize('venue:manage')];
// Organizers propose venues (PENDING) and build their zones / seats until approved (checked by the service).
const canBuild = [authenticate, authorize.any('venue:manage', 'venue:propose')];

/** Mounted at /api/v1/venues */
const venuesRouter = Router();

venuesRouter.get('/', authenticate.optional, validate({ query: schemas.listQuery }), controller.list);
venuesRouter.get('/:id', authenticate.optional, validate({ params: schemas.idParams }), controller.get);
venuesRouter.post('/', ...canBuild, validate({ body: schemas.createVenue }), controller.create);
venuesRouter.patch('/:id', ...canManage, validate({ params: schemas.idParams, body: schemas.updateVenue }), controller.update);
venuesRouter.get('/:id/layout', authenticate.optional, validate({ params: layoutSchemas.idParams }), layoutController.getLayout);
venuesRouter.post(
  '/:venueId/zones',
  ...canBuild,
  validate({ params: layoutSchemas.venueIdParams, body: layoutSchemas.createZone }),
  layoutController.createZone,
);

/** Mounted at /api/v1/zones */
const zonesRouter = Router();

zonesRouter.patch(
  '/:id',
  ...canManage,
  validate({ params: layoutSchemas.idParams, body: layoutSchemas.updateZone }),
  layoutController.updateZone,
);
zonesRouter.post(
  '/:id/seats/bulk',
  ...canBuild,
  validate({ params: layoutSchemas.idParams, body: layoutSchemas.createSeats }),
  layoutController.createSeats,
);

/** Mounted at /api/v1/seats */
const seatsRouter = Router();

seatsRouter.delete('/:id', ...canManage, validate({ params: layoutSchemas.idParams }), layoutController.deleteSeat);

module.exports = { venuesRouter, zonesRouter, seatsRouter };

const AppError = require('../utils/AppError');

function notFound(req, res, next) {
  next(new AppError('NOT_FOUND', 'Route not found.'));
}

module.exports = notFound;

/**
 * Public API of the auth module for other code (middleware, other modules).
 * Routes are mounted from src/routes.js and are deliberately not exported
 * here, to avoid a require cycle (routes → authenticate → this file).
 */
const { verifyAccessToken } = require('./auth.tokens');

module.exports = { verifyAccessToken };

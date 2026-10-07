const { Router } = require('express');
const controller = require('./health.controller');

const router = Router();

router.get('/live', controller.live);
router.get('/ready', controller.ready);

module.exports = router;

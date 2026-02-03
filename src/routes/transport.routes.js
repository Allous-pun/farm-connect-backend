const express = require('express');
const router = express.Router();
const transportController = require('../controllers/transport.controller');
const { protect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');

// Apply authentication middleware to all routes
router.use(protect);

// Transport service routes
router.route('/')
  .get(transportController.getTransports)
  .post(authorize('transport'), transportController.createTransport);

router.route('/route')
  .get(transportController.getTransportsByRoute);

router.route('/my-transports')
  .get(authorize('transport'), transportController.getMyTransports);

router.route('/:id')
  .get(transportController.getTransport)
  .put(transportController.updateTransport)
  .delete(transportController.deleteTransport);

router.route('/:id/book')
  .post(transportController.bookTransport);

router.route('/:id/complete')
  .post(authorize('transport'), transportController.completeTransport);

router.route('/:id/cancel')
  .post(transportController.cancelTransport);

module.exports = router;
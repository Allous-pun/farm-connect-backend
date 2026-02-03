const express = require('express');
const router = express.Router();
const storageController = require('../controllers/storage.controller');
const { protect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');

// Apply authentication middleware to all routes
router.use(protect);

// Storage facility routes
router.route('/')
  .get(storageController.getStorages)
  .post(authorize('storage'), storageController.createStorage);

router.route('/nearby')
  .get(storageController.getNearbyStorages);

router.route('/my-storages')
  .get(authorize('storage'), storageController.getMyStorages);

router.route('/:id')
  .get(storageController.getStorage)
  .put(storageController.updateStorage)
  .delete(storageController.deleteStorage);

router.route('/:id/book')
  .post(storageController.bookStorage);

router.route('/:id/release')
  .post(storageController.releaseStorage);

module.exports = router;
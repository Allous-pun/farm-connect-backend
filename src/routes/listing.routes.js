const express = require('express');
const router = express.Router();
const listingController = require('../controllers/listing.controller');
const imageController = require('../controllers/image.controller');
const upload = require('../config/multer');
const { protect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');

// Apply authentication middleware to all routes
router.use(protect);

// Product listing routes
router.route('/')
  .get(listingController.getListings)
  .post(authorize('farmer'), listingController.createListing);

// Marketplace route - shows all listings including own
router.route('/marketplace')
  .get(listingController.getMarketplaceListings);

router.route('/nearby')
  .get(listingController.getNearbyListings);

router.route('/needing-transport')
  .get(authorize('transport'), listingController.getListingsNeedingTransport);

router.route('/needing-storage')
  .get(authorize('storage'), listingController.getListingsNeedingStorage);

router.route('/my-listings')
  .get(listingController.getMyListings);

router.route('/search')
  .get(listingController.searchListings);

router.route('/map-view')
  .get(listingController.getMapListings);

// Image routes
router.route('/:id/images')
  .post(upload.array('images', 4), imageController.uploadImages);

router.route('/:id/images/:imageIndex')
  .delete(imageController.removeImage);

router.route('/:id/images/:imageIndex/set-primary')
  .put(imageController.setPrimaryImage);

router.route('/:id/images/reorder')
  .put(imageController.reorderImages);

// Single listing routes
router.route('/:id')
  .get(listingController.getListing)
  .put(listingController.updateListing)
  .delete(listingController.deleteListing);

router.route('/:id/close')
  .put(listingController.closeListing);

router.route('/:id/match')
  .put(listingController.markAsMatched);

router.route('/:id/contact')
  .post(listingController.contactOwner);

// Service recommendations
router.route('/:id/recommended-transports')
  .get(authorize('farmer'), listingController.getRecommendedTransports);

router.route('/:id/recommended-storages')
  .get(authorize('farmer'), listingController.getRecommendedStorages);

module.exports = router;
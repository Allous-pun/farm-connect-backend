const express = require('express');
const router = express.Router();
const listingController = require('../controllers/listing.controller');
const imageController = require('../controllers/image.controller');
const upload = require('../config/multer');
const { protect } = require('../middlewares/auth.middleware');

// Apply authentication middleware to all routes
router.use(protect);

// Listing routes
router.route('/')
  .post(listingController.createListing)
  .get(listingController.getListings);

router.route('/nearby')
  .get(listingController.getNearbyListings);

router.route('/my-listings')
  .get(listingController.getMyListings);

router.route('/search')
  .get(listingController.searchListings);

router.route('/map-view')
  .get(listingController.getMapListings);

router.route('/debug/all')
  .get(listingController.debugGetAllListings);

// Image routes
router.route('/:id/images')
  .post(upload.array('images', 4), imageController.uploadImages); // Max 4 images

router.route('/:id/images/:imageIndex')
  .delete(imageController.removeImage);

router.route('/:id/images/:imageIndex/set-primary')
  .put(imageController.setPrimaryImage);

router.route('/:id/images/reorder')
  .put(imageController.reorderImages);

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

module.exports = router;
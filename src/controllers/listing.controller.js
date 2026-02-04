const Listing = require('../models/Listing');
const User = require('../models/User');
const mongoose = require('mongoose');
const { webhookService } = require('../services/webhookService');

// County coordinates mapping
const COUNTY_COORDS = {
  'Nairobi': [36.8172, -1.2864],
  'Mombasa': [39.6682, -4.0435],
  'Kisumu': [34.7617, -0.0917],
  'Nakuru': [36.0667, -0.3031],
  'Eldoret': [35.2698, 0.5143],
  'Thika': [37.0736, -1.0330],
  'Kakamega': [34.7500, 0.2833],
  'Kisii': [34.7833, -0.6833],
  'Meru': [37.6493, 0.0471],
  'Nyeri': [36.9478, -0.4167],
  'Machakos': [37.2667, -1.5167],
  'Kiambu': [36.8356, -1.1711],
  'Muranga': [37.1500, -0.7833],
  'Kirinyaga': [37.2833, -0.6833],
  'Nyandarua': [36.3833, -0.5333],
  'Laikipia': [36.8333, 0.4167],
  'Narok': [35.8667, -1.0833],
  'Kajiado': [36.7833, -1.8333],
  'Makueni': [37.6333, -1.8167],
  'Kitui': [38.0167, -1.3667],
  'Garissa': [39.6500, -0.4500],
  'Wajir': [40.0667, 1.7500],
  'Mandera': [41.8500, 3.9333],
  'Marsabit': [36.9167, 2.3333],
  'Isiolo': [37.5833, 0.3500],
  'Lamu': [40.9000, -2.2667],
  'Tana River': [40.1167, -1.2000],
  'Kilifi': [39.8500, -3.6333],
  'Kwale': [39.4167, -4.1833],
  'Taita Taveta': [38.3667, -3.3667],
  'Busia': [34.1000, 0.4500],
  'Siaya': [34.2833, 0.0667],
  'Homa Bay': [34.6333, -0.5333],
  'Migori': [34.4667, -1.0667],
  'Bomet': [35.3500, -0.7667],
  'Kericho': [35.2833, -0.3667],
  'Bungoma': [34.5667, 0.5667],
  'Vihiga': [34.7333, 0.0833],
  'Trans Nzoia': [35.0000, 1.0333],
  'Uasin Gishu': [35.2833, 0.5167],
  'Elgeyo Marakwet': [35.5667, 0.6333],
  'Nandi': [35.1000, 0.1333],
  'Baringo': [35.9833, 0.5000],
  'Samburu': [37.5167, 0.5333],
  'Turkana': [36.0000, 3.1000],
  'West Pokot': [35.5000, 1.2333],
};

// Helper function to get coordinates for a county
function getCountyCoordinates(countyName) {
  // Try exact match first
  if (COUNTY_COORDS[countyName]) {
    return COUNTY_COORDS[countyName];
  }
  
  // Try case-insensitive match
  const normalizedCounty = Object.keys(COUNTY_COORDS).find(
    key => key.toLowerCase() === countyName.toLowerCase()
  );
  
  if (normalizedCounty) {
    return COUNTY_COORDS[normalizedCounty];
  }
  
  // Return Nairobi as default if county not found
  return COUNTY_COORDS['Nairobi'];
}

// Helper function to calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  // Ensure we have valid numbers
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
    return 0;
  }
  
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  
  return Math.round(distance * 100) / 100;
}

// ============================================
// 1. PERSONAL LISTINGS (User's own posts)
// ============================================

// @desc    Get user's own listings
// @route   GET /api/listings/my-listings
// @access  Private
exports.getMyListings = async (req, res) => {
  try {
    const { 
      status, 
      type, 
      category,
      page = 1, 
      limit = 20 
    } = req.query;
    
    // Build query for user's own listings
    const query = { owner: req.user.id };
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (type && type !== 'all') {
      query.type = type;
    }
    
    if (category && category !== 'all') {
      query.category = category;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const listings = await Listing.find(query)
      .populate('owner', 'name roles averageRating phone')
      .populate('matchedWith', 'name phone')
      .populate('matchedListing', 'title category')
      .populate('transportBooking', 'title route')
      .populate('storageBooking', 'title locationDetails')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Listing.countDocuments(query);

    // Format response
    const formattedListings = listings.map(listing => ({
      ...listing.toObject(),
      isOwnListing: true // Mark as own listing
    }));

    res.json({
      success: true,
      count: listings.length,
      total,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      data: formattedListings
    });

  } catch (error) {
    console.error('Get my listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching your listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================
// 2. MARKETPLACE LISTINGS (Other farmers only)
// ============================================

// @desc    Get marketplace listings (EXCLUDES user's own listings)
// @route   GET /api/listings/marketplace
// @access  Private
exports.getMarketplaceListings = async (req, res) => {
  try {
    const { 
      lat, 
      lng, 
      maxDistance = 50000, // 50km default
      type,
      category,
      urgency,
      needsTransport,
      needsStorage,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Get user's coordinates
    let userCoords;
    if (lat && lng) {
      userCoords = {
        type: 'Point',
        coordinates: [parseFloat(lng), parseFloat(lat)]
      };
    } else {
      // Get user's coordinates from database
      const user = await User.findById(req.user.id).select('coordinates');
      userCoords = user?.coordinates;
    }

    // Build base query - EXCLUDE user's own listings
    const query = {
      owner: { $ne: req.user.id }, // Exclude own listings
      status: 'active',
      expiryDate: { $gt: new Date() }
    };

    // Apply filters
    if (type && type !== 'all') query.type = type;
    if (category && category !== 'all') query.category = category;
    if (urgency && urgency !== 'all') query.urgency = urgency;
    if (needsTransport && needsTransport !== 'all') query['requirements.needsTransport'] = needsTransport === 'true';
    if (needsStorage && needsStorage !== 'all') query['requirements.needsStorage'] = needsStorage === 'true';

    // If we have user coordinates, add geospatial query
    if (userCoords && userCoords.coordinates) {
      query.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: userCoords.coordinates
          },
          $maxDistance: parseInt(maxDistance)
        }
      };
    } else {
      // If no coordinates, still exclude own listings but don't use geospatial query
      console.log('No user coordinates available, skipping geospatial query');
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const listings = await Listing.find(query)
      .populate('owner', 'name roles averageRating profileStatus')
      .populate('transportBooking', 'title route')
      .populate('storageBooking', 'title locationDetails')
      .populate('matchedWith', 'name')
      .populate('matchedListing', 'title category')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Listing.countDocuments(query);

    // Calculate distances and mark as not own listing
    const listingsWithDistance = listings.map(listing => {
      const listingObj = listing.toObject();
      
      // Add distance if user has coordinates
      if (userCoords?.coordinates && listing.location?.coordinates) {
        listingObj.distance = calculateDistance(
          userCoords.coordinates[1], // user lat
          userCoords.coordinates[0], // user lng
          listing.location.coordinates[1], // listing lat
          listing.location.coordinates[0]  // listing lng
        );
      }
      
      // Mark as not own listing
      listingObj.isOwnListing = false;
      
      return listingObj;
    });

    res.json({
      success: true,
      count: listings.length,
      total,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      data: listingsWithDistance
    });

  } catch (error) {
    console.error('Get marketplace listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching marketplace listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================
// 3. BASIC LISTINGS ENDPOINT (Combined - for backward compatibility)
// ============================================

// @desc    Get listings with filters (can include or exclude own listings)
// @route   GET /api/listings
// @access  Private
exports.getListings = async (req, res) => {
  try {
    const { 
      status = 'active',
      type,
      category,
      county,
      urgency,
      needsTransport,
      needsStorage,
      includeSelf = 'false', // Parameter to include own listings
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};
    
    // Status filter
    if (status && status !== 'all') {
      if (status === 'active') {
        query.status = 'active';
        query.expiryDate = { $gt: new Date() };
      } else {
        query.status = status;
      }
    }

    // Other filters
    if (type && type !== 'all') query.type = type;
    if (category && category !== 'all') query.category = category;
    if (urgency && urgency !== 'all') query.urgency = urgency;
    if (county && county !== 'all') query['locationDetails.county'] = { $regex: county, $options: 'i' };
    if (needsTransport && needsTransport !== 'all') query['requirements.needsTransport'] = needsTransport === 'true';
    if (needsStorage && needsStorage !== 'all') query['requirements.needsStorage'] = needsStorage === 'true';
    
    // Include/exclude own listings
    if (includeSelf !== 'true') {
      query.owner = { $ne: req.user.id };
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const listings = await Listing.find(query)
      .populate('owner', 'name roles averageRating profileStatus')
      .populate('transportBooking', 'title route')
      .populate('storageBooking', 'title locationDetails')
      .populate('matchedWith', 'name')
      .populate('matchedListing', 'title category')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Listing.countDocuments(query);

    // Mark ownership
    const listingsWithOwnership = listings.map(listing => {
      const listingObj = listing.toObject();
      listingObj.isOwnListing = listing.owner._id.toString() === req.user.id;
      return listingObj;
    });

    res.json({
      success: true,
      count: listings.length,
      total,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      data: listingsWithOwnership
    });

  } catch (error) {
    console.error('Get listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================
// 4. OTHER EXISTING FUNCTIONS
// ============================================

// @desc    Create a new listing (only farmers can create)
// @route   POST /api/listings
// @access  Private
exports.createListing = async (req, res) => {
  try {
    // Check if user has farmer role
    if (!req.user.roles.includes('farmer')) {
      return res.status(403).json({
        success: false,
        message: 'Only users with farmer role can create product listings'
      });
    }

    const { 
      title, 
      description, 
      type, 
      category, 
      productDetails, 
      price, 
      locationDetails,
      requirements,
      urgency,
      expiryDays = 7
    } = req.body;

    // Get user's location
    const user = await User.findById(req.user.id);
    
    // Check if user already has an active listing in same category
    const existingActiveListing = await Listing.findOne({
      owner: req.user.id,
      category,
      status: 'active',
      expiryDate: { $gt: new Date() }
    });

    if (existingActiveListing) {
      return res.status(400).json({
        success: false,
        message: `You already have an active ${category} listing. Please close it before creating a new one.`
      });
    }

    // Calculate expiry date
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);

    // Determine coordinates based on county
    let coordinates;
    if (locationDetails?.county) {
      coordinates = getCountyCoordinates(locationDetails.county);
    } else {
      // Use user coordinates if no county specified
      coordinates = user.coordinates.coordinates;
    }

    // Create listing
    const listing = new Listing({
      title,
      description,
      type,
      category,
      productDetails,
      price,
      requirements,
      urgency: urgency || 'medium',
      owner: req.user.id,
      location: {
        type: 'Point',
        coordinates: coordinates
      },
      locationDetails: {
        ...locationDetails,
        county: locationDetails?.county || user.location?.address?.county
      },
      expiryDate
    });

    // Add tags
    listing.tags = [type, category];
    if (urgency) listing.tags.push(urgency);
    if (requirements?.needsTransport) listing.tags.push('needs-transport');
    if (requirements?.needsStorage) listing.tags.push('needs-storage');

    await listing.save();

    res.status(201).json({
      success: true,
      data: listing,
      message: 'Listing created successfully'
    });

  } catch (error) {
    console.error('Create listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get single listing
// @route   GET /api/listings/:id
// @access  Private
exports.getListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('owner', 'name roles averageRating phone bio farm.yearsFarming')
      .populate('transportBooking', 'title route vehicleDetails pricing')
      .populate('storageBooking', 'title locationDetails facilityDetails pricing')
      .populate('matchedWith', 'name phone')
      .populate('matchedListing', 'title category');

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Increment view count
    await listing.incrementViewCount();

    res.json({
      success: true,
      data: listing
    });

  } catch (error) {
    console.error('Get listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update listing
// @route   PUT /api/listings/:id
// @access  Private
exports.updateListing = async (req, res) => {
  try {
    let listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this listing'
      });
    }

    // Don't allow updates if listing is matched or closed
    if (['matched', 'closed', 'expired'].includes(listing.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update a ${listing.status} listing`
      });
    }

    // Update only allowed fields
    const allowedUpdates = [
      'title', 'description', 'productDetails', 'price', 
      'requirements', 'urgency', 'locationDetails', 'images', 'tags'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        listing[field] = req.body[field];
      }
    });

    // If locationDetails.county is updated, update coordinates too
    if (req.body.locationDetails?.county && req.body.locationDetails.county !== listing.locationDetails?.county) {
      const newCoordinates = getCountyCoordinates(req.body.locationDetails.county);
      listing.location.coordinates = newCoordinates;
    }

    // Update tags based on requirements
    if (req.body.requirements) {
      const tagsToUpdate = [listing.type, listing.category];
      if (listing.urgency) tagsToUpdate.push(listing.urgency);
      if (listing.requirements?.needsTransport) tagsToUpdate.push('needs-transport');
      if (listing.requirements?.needsStorage) tagsToUpdate.push('needs-storage');
      listing.tags = tagsToUpdate;
    }

    await listing.save();

    res.json({
      success: true,
      data: listing,
      message: 'Listing updated successfully'
    });

  } catch (error) {
    console.error('Update listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete listing
// @route   DELETE /api/listings/:id
// @access  Private
exports.deleteListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership (only owner or admin can delete)
    if (listing.owner.toString() !== req.user.id && !req.user.roles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this listing'
      });
    }

    await listing.deleteOne();

    res.json({
      success: true,
      message: 'Listing deleted successfully'
    });

  } catch (error) {
    console.error('Delete listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Close listing
// @route   PUT /api/listings/:id/close
// @access  Private
exports.closeListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to close this listing'
      });
    }

    await listing.markAsClosed();

    res.json({
      success: true,
      message: 'Listing closed successfully'
    });

  } catch (error) {
    console.error('Close listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error closing listing',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Mark listing as matched
// @route   PUT /api/listings/:id/match
// @access  Private
exports.markAsMatched = async (req, res) => {
  try {
    const { matchedWith, matchedListing } = req.body;
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to mark this listing as matched'
      });
    }

    await listing.markAsMatched(matchedWith, matchedListing);

    // Trigger webhook for listing match
    await webhookService.triggerWebhook(
      'listing.matched',
      {
        listingId: listing._id,
        matchedWith: matchedWith,
        matchedListing: matchedListing,
        owner: listing.owner,
        timestamp: new Date().toISOString()
      },
      listing.owner.toString()
    ).catch(err => console.error('Webhook error:', err));

    res.json({
      success: true,
      message: 'Listing marked as matched successfully'
    });

  } catch (error) {
    console.error('Mark as matched error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking listing as matched',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Contact listing owner
// @route   POST /api/listings/:id/contact
// @access  Private
exports.contactOwner = async (req, res) => {
  try {
    const { message } = req.body;
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check if listing is active
    if (listing.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot contact owner of inactive listing'
      });
    }

    // Check if user is not the owner
    if (listing.owner.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot contact yourself'
      });
    }

    // Get owner details (excluding sensitive info)
    const owner = await User.findById(listing.owner)
      .select('name phone roles averageRating');

    // Increment chat count on listing
    await listing.incrementChatCount();

    res.json({
      success: true,
      message: 'Contact request sent successfully',
      data: {
        owner: {
          name: owner.name,
          phone: owner.phone,
          roles: owner.roles,
          averageRating: owner.averageRating
        },
        listing: {
          title: listing.title,
          category: listing.category,
          type: listing.type
        },
        contactMessage: message || `Interested in your ${listing.category} listing: ${listing.title}`
      }
    });

  } catch (error) {
    console.error('Contact owner error:', error);
    res.status(500).json({
      success: false,
      message: 'Error contacting owner',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================
// 5. TRANSPORT AND STORAGE SPECIFIC FUNCTIONS
// ============================================

// @desc    Get listings needing transport services
// @route   GET /api/listings/needing-transport
// @access  Private (Transporters)
exports.getListingsNeedingTransport = async (req, res) => {
  try {
    // Check if user has transport role
    if (!req.user.roles.includes('transport')) {
      return res.status(403).json({
        success: false,
        message: 'Only transporters can access this endpoint'
      });
    }

    const { 
      county,
      maxDistance = 50000,
      minQuantity,
      category,
      page = 1,
      limit = 20
    } = req.query;

    // Get user's location
    const user = await User.findById(req.user.id);
    const userCoords = user.coordinates.coordinates;

    const query = {
      'requirements.needsTransport': true,
      status: 'active',
      expiryDate: { $gt: new Date() },
      owner: { $ne: req.user.id } // Exclude own listings
    };

    // Location filter
    if (county) {
      query['locationDetails.county'] = { $regex: county, $options: 'i' };
    } else {
      // Filter by distance from transporter
      query.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: userCoords
          },
          $maxDistance: parseInt(maxDistance)
        }
      };
    }

    // Other filters
    if (minQuantity) {
      query['productDetails.quantity'] = { $gte: parseFloat(minQuantity) };
    }
    if (category) {
      query.category = category;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const listings = await Listing.find(query)
      .populate('owner', 'name roles averageRating locationDetails')
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Listing.countDocuments(query);

    // Calculate distances
    const listingsWithDistance = listings.map(listing => {
      const listingObj = listing.toObject();
      listingObj.distance = calculateDistance(
        userCoords[1], userCoords[0],
        listing.location.coordinates[1], listing.location.coordinates[0]
      );
      return listingObj;
    });

    res.json({
      success: true,
      count: listings.length,
      total,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      data: listingsWithDistance
    });

  } catch (error) {
    console.error('Get listings needing transport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get listings needing storage services
// @route   GET /api/listings/needing-storage
// @access  Private (Storage providers)
exports.getListingsNeedingStorage = async (req, res) => {
  try {
    // Check if user has storage role
    if (!req.user.roles.includes('storage')) {
      return res.status(403).json({
        success: false,
        message: 'Only storage providers can access this endpoint'
      });
    }

    const { 
      county,
      maxDistance = 50000,
      minQuantity,
      category,
      page = 1,
      limit = 20
    } = req.query;

    // Get user's location
    const user = await User.findById(req.user.id);
    const userCoords = user.coordinates.coordinates;

    const query = {
      'requirements.needsStorage': true,
      status: 'active',
      expiryDate: { $gt: new Date() },
      owner: { $ne: req.user.id } // Exclude own listings
    };

    // Location filter
    if (county) {
      query['locationDetails.county'] = { $regex: county, $options: 'i' };
    } else {
      // Filter by distance from storage provider
      query.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: userCoords
          },
          $maxDistance: parseInt(maxDistance)
        }
      };
    }

    // Other filters
    if (minQuantity) {
      query['productDetails.quantity'] = { $gte: parseFloat(minQuantity) };
    }
    if (category) {
      query.category = category;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const listings = await Listing.find(query)
      .populate('owner', 'name roles averageRating locationDetails')
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Listing.countDocuments(query);

    // Calculate distances
    const listingsWithDistance = listings.map(listing => {
      const listingObj = listing.toObject();
      listingObj.distance = calculateDistance(
        userCoords[1], userCoords[0],
        listing.location.coordinates[1], listing.location.coordinates[0]
      );
      return listingObj;
    });

    res.json({
      success: true,
      count: listings.length,
      total,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      data: listingsWithDistance
    });

  } catch (error) {
    console.error('Get listings needing storage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get recommended transport services for a listing
// @route   GET /api/listings/:id/recommended-transports
// @access  Private (Listing owner only)
exports.getRecommendedTransports = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view recommended transports for this listing'
      });
    }

    // This function now calls the transport controller's getTransports function
    // Since transports are in a separate controller, we need to import it
    // For now, we'll return a message indicating this feature needs to be implemented
    res.json({
      success: true,
      message: 'Recommended transports feature needs to be implemented in transport controller',
      data: []
    });

  } catch (error) {
    console.error('Get recommended transports error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching recommended transports',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get recommended storage facilities for a listing
// @route   GET /api/listings/:id/recommended-storages
// @access  Private (Listing owner only)
exports.getRecommendedStorages = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view recommended storages for this listing'
      });
    }

    // This function now calls the storage controller's getStorages function
    // Since storages are in a separate controller, we need to import it
    // For now, we'll return a message indicating this feature needs to be implemented
    res.json({
      success: true,
      message: 'Recommended storages feature needs to be implemented in storage controller',
      data: []
    });

  } catch (error) {
    console.error('Get recommended storages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching recommended storages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Search listings
// @route   GET /api/listings/search
// @access  Private
exports.searchListings = async (req, res) => {
  try {
    const { 
      q, 
      category, 
      type, 
      minQuantity, 
      maxQuantity,
      county,
      sortBy = 'recent'
    } = req.query;

    const query = {
      status: 'active',
      expiryDate: { $gt: new Date() },
      owner: { $ne: req.user.id }
    };

    // Text search
    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { tags: { $regex: q, $options: 'i' } }
      ];
    }

    // Filters
    if (category) query.category = category;
    if (type) query.type = type;
    if (county) query['locationDetails.county'] = { $regex: county, $options: 'i' };
    
    // Quantity filters
    if (minQuantity || maxQuantity) {
      query['productDetails.quantity'] = {};
      if (minQuantity) query['productDetails.quantity'].$gte = parseFloat(minQuantity);
      if (maxQuantity) query['productDetails.quantity'].$lte = parseFloat(maxQuantity);
    }

    // Sort
    let sort = {};
    switch (sortBy) {
      case 'recent':
        sort.createdAt = -1;
        break;
      case 'urgent':
        sort.urgency = -1;
        sort.createdAt = -1;
        break;
      case 'quantity':
        sort['productDetails.quantity'] = -1;
        break;
      default:
        sort.createdAt = -1;
    }

    const listings = await Listing.find(query)
      .populate('owner', 'name roles averageRating')
      .sort(sort)
      .limit(50);

    res.json({
      success: true,
      count: listings.length,
      data: listings
    });

  } catch (error) {
    console.error('Search listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get listings by map bounds (for map view)
// @route   GET /api/listings/map-view
// @access  Private
exports.getMapListings = async (req, res) => {
  try {
    const { 
      swLat, 
      swLng, 
      neLat, 
      neLng,
      type,
      category
    } = req.query;

    if (!swLat || !swLng || !neLat || !neLng) {
      return res.status(400).json({
        success: false,
        message: 'Map bounds are required'
      });
    }

    const query = {
      location: {
        $geoWithin: {
          $box: [
            [parseFloat(swLng), parseFloat(swLat)], // Southwest corner
            [parseFloat(neLng), parseFloat(neLat)]  // Northeast corner
          ]
        }
      },
      status: 'active',
      expiryDate: { $gt: new Date() },
      owner: { $ne: req.user.id }
    };

    // Apply filters
    if (type) query.type = type;
    if (category) query.category = category;

    const listings = await Listing.find(query)
      .select('title type category location locationDetails urgency createdAt productDetails.quantity productDetails.unit')
      .populate('owner', 'name')
      .limit(100);

    res.json({
      success: true,
      count: listings.length,
      data: listings
    });

  } catch (error) {
    console.error('Get map listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching map listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get nearby listings
// @route   GET /api/listings/nearby
// @access  Private
exports.getNearbyListings = async (req, res) => {
  try {
    const { 
      lat, 
      lng, 
      maxDistance = 20000, // 20km default
      type,
      category,
      urgency,
      needsTransport,
      needsStorage,
      includeSelf = 'false',
      sortBy = 'distance',
      limit = 50
    } = req.query;

    // Use provided coordinates or user's coordinates
    let coordinates;
    if (lat && lng) {
      coordinates = [parseFloat(lng), parseFloat(lat)];
    } else {
      const user = await User.findById(req.user.id);
      coordinates = user.coordinates.coordinates;
    }

    // Build query
    const query = {
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates
          },
          $maxDistance: parseInt(maxDistance)
        }
      },
      status: 'active',
      expiryDate: { $gt: new Date() }
    };

    // Only exclude user's own listings if includeSelf is false
    if (includeSelf !== 'true') {
      query.owner = { $ne: req.user.id };
    }

    // Apply filters
    if (type) query.type = type;
    if (category) query.category = category;
    if (urgency) query.urgency = urgency;
    if (needsTransport) query['requirements.needsTransport'] = needsTransport === 'true';
    if (needsStorage) query['requirements.needsStorage'] = needsStorage === 'true';

    // Build sort
    let sort = {};
    switch (sortBy) {
      case 'distance':
        // Geo query already sorts by distance
        break;
      case 'recent':
        sort.createdAt = -1;
        break;
      case 'urgent':
        sort.urgency = -1;
        sort.createdAt = -1;
        break;
      default:
        sort.createdAt = -1;
    }

    // Execute query
    const listings = await Listing.find(query)
      .populate('owner', 'name roles averageRating location.address.county')
      .sort(sort)
      .limit(parseInt(limit));

    // Calculate distances for each listing
    const listingsWithDistance = listings.map(listing => {
      const listingObj = listing.toObject();
      
      // Add distance information
      if (coordinates && listing.location.coordinates) {
        listingObj.distance = calculateDistance(
          coordinates[1], coordinates[0], // lat, lng
          listing.location.coordinates[1], listing.location.coordinates[0]
        );
      }
      
      return listingObj;
    });

    res.json({
      success: true,
      count: listings.length,
      data: listingsWithDistance
    });

  } catch (error) {
    console.error('Get nearby listings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
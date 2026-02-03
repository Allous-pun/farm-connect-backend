const Storage = require('../models/Storage');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { webhookService } = require('../services/webhookService');

const COUNTY_COORDS = {
  'Nairobi': [36.8172, -1.2864],
  'Mombasa': [39.6682, -4.0435],
  // ... (same as before, keep all counties)
};

// Helper function to get coordinates for a county
function getCountyCoordinates(countyName) {
  if (COUNTY_COORDS[countyName]) {
    return COUNTY_COORDS[countyName];
  }
  
  const normalizedCounty = Object.keys(COUNTY_COORDS).find(
    key => key.toLowerCase() === countyName.toLowerCase()
  );
  
  if (normalizedCounty) {
    return COUNTY_COORDS[normalizedCounty];
  }
  
  return COUNTY_COORDS['Nairobi'];
}

// @desc    Get all storage facilities
// @route   GET /api/storages
// @access  Private
exports.getStorages = async (req, res) => {
  try {
    const { 
      county,
      facilityType,
      availability = 'available',
      minCapacity,
      maxCapacity,
      temperatureControlled,
      productType,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};
    
    // Availability filter
    if (availability) {
      query.availability = availability;
    }
    
    // Location filter
    if (county) query['locationDetails.county'] = { $regex: county, $options: 'i' };
    
    // Facility filters
    if (facilityType) query.facilityType = facilityType;
    if (temperatureControlled !== undefined) {
      query['facilityDetails.temperatureControlled'] = temperatureControlled === 'true';
    }
    
    // Capacity filters
    if (minCapacity) {
      query['facilityDetails.availableCapacity'] = { $gte: parseInt(minCapacity) };
    }
    if (maxCapacity) {
      query['facilityDetails.totalCapacity'] = { $lte: parseInt(maxCapacity) };
    }
    
    // Product type filter
    if (productType) query.acceptedProducts = productType;
    
    // Status filter
    query.status = 'active';
    query.expiryDate = { $gt: new Date() };
    
    // For non-owners, only show available storage
    if (!req.user.roles.includes('admin')) {
      query.owner = { $ne: req.user.id };
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const storages = await Storage.find(query)
      .populate('owner', 'name roles averageRating profileStatus roleSpecificInfo.storage')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Storage.countDocuments(query);

    res.json({
      success: true,
      count: storages.length,
      total,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      data: storages
    });

  } catch (error) {
    console.error('Get storages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching storage facilities',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Create a new storage facility
// @route   POST /api/storages
// @access  Private (Storage providers only)
exports.createStorage = async (req, res) => {
  try {
    // Check if user has storage role
    if (!req.user.roles.includes('storage')) {
      return res.status(403).json({
        success: false,
        message: 'Only users with storage role can create storage facilities'
      });
    }

    const { 
      title, 
      description, 
      facilityType, 
      facilityDetails, 
      locationDetails,
      services,
      pricing,
      acceptedProducts,
      productRestrictions,
      availability
    } = req.body;

    // Validate location
    if (!locationDetails?.county) {
      return res.status(400).json({
        success: false,
        message: 'County information is required'
      });
    }

    // Get coordinates for county
    const coordinates = getCountyCoordinates(locationDetails.county);

    // Create storage facility
    const storage = new Storage({
      title,
      description,
      facilityType,
      facilityDetails,
      location: {
        type: 'Point',
        coordinates
      },
      locationDetails: {
        ...locationDetails,
        county: locationDetails.county
      },
      services,
      pricing,
      acceptedProducts,
      productRestrictions,
      availability,
      owner: req.user.id
    });

    // Add tags
    storage.tags = [
      facilityType,
      locationDetails.county,
      ...services
    ];

    await storage.save();

    res.status(201).json({
      success: true,
      data: storage,
      message: 'Storage facility created successfully'
    });

  } catch (error) {
    console.error('Create storage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating storage facility',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get storage facilities by location
// @route   GET /api/storages/nearby
// @access  Private
exports.getNearbyStorages = async (req, res) => {
  try {
    const { 
      lat, 
      lng, 
      maxDistance = 50000,
      facilityType,
      productType,
      minCapacity
    } = req.query;

    // Use provided coordinates or user's coordinates
    let coordinates;
    if (lat && lng) {
      coordinates = [parseFloat(lng), parseFloat(lat)];
    } else {
      const user = await User.findById(req.user.id);
      coordinates = user.coordinates.coordinates;
    }

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
      availability: { $in: ['available', 'partially_available'] },
      status: 'active',
      expiryDate: { $gt: new Date() },
      owner: { $ne: req.user.id } // Exclude user's own facilities
    };

    // Apply filters
    if (facilityType) query.facilityType = facilityType;
    if (productType) query.acceptedProducts = productType;
    if (minCapacity) {
      query['facilityDetails.availableCapacity'] = { $gte: parseInt(minCapacity) };
    }

    const storages = await Storage.find(query)
      .populate('owner', 'name roles averageRating locationDetails')
      .limit(20);

    res.json({
      success: true,
      count: storages.length,
      data: storages
    });

  } catch (error) {
    console.error('Get nearby storages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching storage facilities',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get user's storage facilities
// @route   GET /api/storages/my-storages
// @access  Private (Storage providers only)
exports.getMyStorages = async (req, res) => {
  try {
    const { status } = req.query;
    
    const query = { owner: req.user.id };
    if (status) query.status = status;
    
    const storages = await Storage.find(query)
      .populate('currentBookings.bookedBy', 'name phone')
      .sort('-createdAt');

    res.json({
      success: true,
      count: storages.length,
      data: storages
    });

  } catch (error) {
    console.error('Get my storages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching your storage facilities',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get single storage facility
// @route   GET /api/storages/:id
// @access  Private
exports.getStorage = async (req, res) => {
  try {
    const storage = await Storage.findById(req.params.id)
      .populate('owner', 'name roles averageRating phone bio roleSpecificInfo.storage')
      .populate('currentBookings.bookedBy', 'name phone');

    if (!storage) {
      return res.status(404).json({
        success: false,
        message: 'Storage facility not found'
      });
    }

    // Increment view count
    await storage.incrementViewCount();

    res.json({
      success: true,
      data: storage
    });

  } catch (error) {
    console.error('Get storage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching storage facility',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update storage facility
// @route   PUT /api/storages/:id
// @access  Private (Owner or Admin)
exports.updateStorage = async (req, res) => {
  try {
    let storage = await Storage.findById(req.params.id);

    if (!storage) {
      return res.status(404).json({
        success: false,
        message: 'Storage facility not found'
      });
    }

    // Check ownership
    if (storage.owner.toString() !== req.user.id && !req.user.roles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this storage facility'
      });
    }

    // Allowed updates
    const allowedUpdates = [
      'title', 'description', 'facilityDetails', 'services', 
      'pricing', 'acceptedProducts', 'productRestrictions', 
      'availability', 'images', 'tags', 'certifications'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        storage[field] = req.body[field];
      }
    });

    // Update location if provided
    if (req.body.locationDetails?.county) {
      storage.locationDetails.county = req.body.locationDetails.county;
      storage.location.coordinates = getCountyCoordinates(req.body.locationDetails.county);
    }

    await storage.save();

    res.json({
      success: true,
      data: storage,
      message: 'Storage facility updated successfully'
    });

  } catch (error) {
    console.error('Update storage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating storage facility',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Book storage facility
// @route   POST /api/storages/:id/book
// @access  Private
exports.bookStorage = async (req, res) => {
  try {
    const { 
      product, 
      quantity, 
      startDate, 
      endDate,
      listingId 
    } = req.body;

    const storage = await Storage.findById(req.params.id);

    if (!storage) {
      return res.status(404).json({
        success: false,
        message: 'Storage facility not found'
      });
    }

    // Check if storage has capacity
    if (storage.facilityDetails.availableCapacity < quantity) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient storage capacity available'
      });
    }

    // Check if product is accepted
    if (!storage.acceptedProducts.includes(product)) {
      return res.status(400).json({
        success: false,
        message: 'This product type is not accepted by this storage facility'
      });
    }

    // Prepare booking data
    const bookingData = {
      bookedBy: req.user.id,
      product,
      quantity,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      status: 'active'
    };

    // Book the storage
    await storage.bookStorage(bookingData);

    // Update listing if provided
    if (listingId) {
      const listing = await Listing.findById(listingId);
      if (listing && listing.owner.toString() === req.user.id) {
        await listing.bookStorage(storage._id);
      }
    }

    // Trigger webhook
    await webhookService.triggerWebhook(
      'storage.booked',
      {
        storageId: storage._id,
        bookedBy: req.user.id,
        product,
        quantity,
        startDate,
        endDate,
        owner: storage.owner,
        timestamp: new Date().toISOString()
      },
      storage.owner.toString()
    ).catch(err => console.error('Webhook error:', err));

    res.json({
      success: true,
      message: 'Storage facility booked successfully',
      data: {
        storageId: storage._id,
        bookingId: storage.currentBookings[storage.currentBookings.length - 1]._id,
        availableCapacity: storage.facilityDetails.availableCapacity
      }
    });

  } catch (error) {
    console.error('Book storage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error booking storage facility',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Release storage space
// @route   POST /api/storages/:id/release
// @access  Private (Owner or Booker)
exports.releaseStorage = async (req, res) => {
  try {
    const { bookingId, quantity } = req.body;
    const storage = await Storage.findById(req.params.id);

    if (!storage) {
      return res.status(404).json({
        success: false,
        message: 'Storage facility not found'
      });
    }

    // Find booking
    const booking = storage.currentBookings.id(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check authorization (owner or the user who booked it)
    const isOwner = storage.owner.toString() === req.user.id;
    const isBooker = booking.bookedBy?.toString() === req.user.id;
    
    if (!isOwner && !isBooker) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to release this storage space'
      });
    }

    await storage.releaseStorage(bookingId, quantity);

    res.json({
      success: true,
      message: 'Storage space released successfully',
      data: {
        availableCapacity: storage.facilityDetails.availableCapacity
      }
    });

  } catch (error) {
    console.error('Release storage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error releasing storage space',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete storage facility
// @route   DELETE /api/storages/:id
// @access  Private (Owner or Admin)
exports.deleteStorage = async (req, res) => {
  try {
    const storage = await Storage.findById(req.params.id);

    if (!storage) {
      return res.status(404).json({
        success: false,
        message: 'Storage facility not found'
      });
    }

    // Check ownership
    if (storage.owner.toString() !== req.user.id && !req.user.roles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this storage facility'
      });
    }

    // Don't allow deletion if there are active bookings
    const hasActiveBookings = storage.currentBookings.some(
      booking => booking.status === 'active'
    );
    
    if (hasActiveBookings) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete storage facility with active bookings'
      });
    }

    await storage.deleteOne();

    res.json({
      success: true,
      message: 'Storage facility deleted successfully'
    });

  } catch (error) {
    console.error('Delete storage error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting storage facility',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
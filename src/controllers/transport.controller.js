const Transport = require('../models/Transport');
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

// Helper function to calculate distance
function calculateDistance(lat1, lon1, lat2, lon2) {
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

// @desc    Get all transport services
// @route   GET /api/transports
// @access  Private
exports.getTransports = async (req, res) => {
  try {
    const { 
      status = 'available',
      fromCounty,
      toCounty,
      vehicleType,
      serviceType,
      minCapacity,
      availability,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};
    
    // Status filter
    if (status) {
      query.status = status;
    }
    
    // Location filters
    if (fromCounty) query['route.from.county'] = { $regex: fromCounty, $options: 'i' };
    if (toCounty) query['route.to.county'] = { $regex: toCounty, $options: 'i' };
    
    // Vehicle filters
    if (vehicleType) query['vehicleDetails.vehicleType'] = vehicleType;
    if (serviceType) query.serviceType = serviceType;
    if (availability) query.availability = availability;
    
    // Capacity filter
    if (minCapacity) {
      query['vehicleDetails.capacity'] = { $gte: parseInt(minCapacity) };
    }
    
    // For non-owners, only show available transports
    if (!req.user.roles.includes('admin')) {
      query.owner = { $ne: req.user.id };
      query.status = 'available';
      query.expiryDate = { $gt: new Date() };
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transports = await Transport.find(query)
      .populate('owner', 'name roles averageRating profileStatus roleSpecificInfo.transport')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Transport.countDocuments(query);

    res.json({
      success: true,
      count: transports.length,
      total,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      },
      data: transports
    });

  } catch (error) {
    console.error('Get transports error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching transport services',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Create a new transport service
// @route   POST /api/transports
// @access  Private (Transporters only)
exports.createTransport = async (req, res) => {
  try {
    // Check if user has transport role
    if (!req.user.roles.includes('transport')) {
      return res.status(403).json({
        success: false,
        message: 'Only users with transport role can create transport services'
      });
    }

    const { 
      title, 
      description, 
      serviceType, 
      vehicleDetails, 
      route, 
      pricing, 
      cargoRequirements,
      availability,
      schedule
    } = req.body;

    // Validate route coordinates
    if (!route?.from?.county || !route?.to?.county) {
      return res.status(400).json({
        success: false,
        message: 'Route information (from and to counties) is required'
      });
    }

    // Get coordinates for counties
    const fromCoords = getCountyCoordinates(route.from.county);
    const toCoords = getCountyCoordinates(route.to.county);

    // Calculate estimated distance
    const estimatedDistance = calculateDistance(
      fromCoords[1], fromCoords[0],
      toCoords[1], toCoords[0]
    );

    // Create transport service
    const transport = new Transport({
      title,
      description,
      serviceType,
      vehicleDetails,
      route: {
        from: {
          county: route.from.county,
          subCounty: route.from.subCounty,
          coordinates: fromCoords
        },
        to: {
          county: route.to.county,
          subCounty: route.to.subCounty,
          coordinates: toCoords
        },
        via: route.via?.map(viaPoint => ({
          county: viaPoint.county,
          coordinates: viaPoint.coordinates || getCountyCoordinates(viaPoint.county)
        })) || []
      },
      pricing: {
        ...pricing,
        estimatedDistance
      },
      cargoRequirements,
      availability,
      schedule,
      owner: req.user.id
    });

    // Add tags
    transport.tags = [
      serviceType,
      vehicleDetails.vehicleType,
      route.from.county,
      route.to.county
    ];

    await transport.save();

    res.status(201).json({
      success: true,
      data: transport,
      message: 'Transport service created successfully'
    });

  } catch (error) {
    console.error('Create transport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating transport service',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get transport services by route
// @route   GET /api/transports/route
// @access  Private
exports.getTransportsByRoute = async (req, res) => {
  try {
    const { 
      fromCounty, 
      toCounty, 
      fromLat, 
      fromLng, 
      toLat, 
      toLng,
      maxDistance = 50000
    } = req.query;

    if (!fromCounty || !toCounty) {
      return res.status(400).json({
        success: false,
        message: 'From and to counties are required'
      });
    }

    let fromCoords, toCoords;
    
    if (fromLat && fromLng) {
      fromCoords = [parseFloat(fromLng), parseFloat(fromLat)];
    } else {
      fromCoords = getCountyCoordinates(fromCounty);
    }
    
    if (toLat && toLng) {
      toCoords = [parseFloat(toLng), parseFloat(toLat)];
    } else {
      toCoords = getCountyCoordinates(toCounty);
    }

    // Find transports by route
    const transports = await Transport.findByRoute(fromCoords, toCoords, parseInt(maxDistance))
      .populate('owner', 'name roles averageRating phone roleSpecificInfo.transport')
      .limit(20);

    res.json({
      success: true,
      count: transports.length,
      data: transports
    });

  } catch (error) {
    console.error('Get transports by route error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching transport services',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get user's transport services
// @route   GET /api/transports/my-transports
// @access  Private (Transporters only)
exports.getMyTransports = async (req, res) => {
  try {
    const { status } = req.query;
    
    const query = { owner: req.user.id };
    if (status) query.status = status;
    
    const transports = await Transport.find(query)
      .populate('bookedBy', 'name phone')
      .populate('bookedForListing', 'title category')
      .sort('-createdAt');

    res.json({
      success: true,
      count: transports.length,
      data: transports
    });

  } catch (error) {
    console.error('Get my transports error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching your transport services',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get single transport service
// @route   GET /api/transports/:id
// @access  Private
exports.getTransport = async (req, res) => {
  try {
    const transport = await Transport.findById(req.params.id)
      .populate('owner', 'name roles averageRating phone bio roleSpecificInfo.transport')
      .populate('bookedBy', 'name phone')
      .populate('bookedForListing', 'title category productDetails');

    if (!transport) {
      return res.status(404).json({
        success: false,
        message: 'Transport service not found'
      });
    }

    // Increment view count
    await transport.incrementViewCount();

    res.json({
      success: true,
      data: transport
    });

  } catch (error) {
    console.error('Get transport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching transport service',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update transport service
// @route   PUT /api/transports/:id
// @access  Private (Owner or Admin)
exports.updateTransport = async (req, res) => {
  try {
    let transport = await Transport.findById(req.params.id);

    if (!transport) {
      return res.status(404).json({
        success: false,
        message: 'Transport service not found'
      });
    }

    // Check ownership
    if (transport.owner.toString() !== req.user.id && !req.user.roles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this transport service'
      });
    }

    // Don't allow updates if booked or in transit
    if (['booked', 'in_transit'].includes(transport.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update a ${transport.status} transport service`
      });
    }

    // Allowed updates
    const allowedUpdates = [
      'title', 'description', 'vehicleDetails', 'pricing', 
      'cargoRequirements', 'availability', 'schedule', 'images', 'tags'
    ];
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        transport[field] = req.body[field];
      }
    });

    // Update route if provided
    if (req.body.route) {
      if (req.body.route.from?.county) {
        transport.route.from.county = req.body.route.from.county;
        transport.route.from.coordinates = getCountyCoordinates(req.body.route.from.county);
      }
      if (req.body.route.to?.county) {
        transport.route.to.county = req.body.route.to.county;
        transport.route.to.coordinates = getCountyCoordinates(req.body.route.to.county);
      }
      
      // Recalculate distance
      const estimatedDistance = calculateDistance(
        transport.route.from.coordinates[1], transport.route.from.coordinates[0],
        transport.route.to.coordinates[1], transport.route.to.coordinates[0]
      );
      
      transport.pricing.estimatedDistance = estimatedDistance;
    }

    await transport.save();

    res.json({
      success: true,
      data: transport,
      message: 'Transport service updated successfully'
    });

  } catch (error) {
    console.error('Update transport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating transport service',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Book transport service
// @route   POST /api/transports/:id/book
// @access  Private
exports.bookTransport = async (req, res) => {
  try {
    const { listingId } = req.body;
    const transport = await Transport.findById(req.params.id);

    if (!transport) {
      return res.status(404).json({
        success: false,
        message: 'Transport service not found'
      });
    }

    // Check if transport is available
    if (transport.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: 'Transport service is not available'
      });
    }

    // Check if listing exists and belongs to user
    if (listingId) {
      const listing = await Listing.findById(listingId);
      if (!listing) {
        return res.status(404).json({
          success: false,
          message: 'Listing not found'
        });
      }

      if (listing.owner.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to book transport for this listing'
        });
      }

      // Book the transport
      await transport.bookTransport(req.user.id, listingId);
      
      // Update listing with transport booking
      await listing.bookTransport(transport._id);

      // Trigger webhook
      await webhookService.triggerWebhook(
        'transport.booked',
        {
          transportId: transport._id,
          bookedBy: req.user.id,
          listingId: listingId,
          owner: transport.owner,
          timestamp: new Date().toISOString()
        },
        transport.owner.toString()
      ).catch(err => console.error('Webhook error:', err));

      res.json({
        success: true,
        message: 'Transport service booked successfully',
        data: {
          transportId: transport._id,
          listingId: listingId,
          bookedAt: transport.bookedAt
        }
      });
    } else {
      // Book without listing (direct booking)
      await transport.bookTransport(req.user.id);
      
      res.json({
        success: true,
        message: 'Transport service booked successfully',
        data: {
          transportId: transport._id,
          bookedAt: transport.bookedAt
        }
      });
    }

  } catch (error) {
    console.error('Book transport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error booking transport service',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Complete transport service
// @route   POST /api/transports/:id/complete
// @access  Private (Owner only)
exports.completeTransport = async (req, res) => {
  try {
    const transport = await Transport.findById(req.params.id);

    if (!transport) {
      return res.status(404).json({
        success: false,
        message: 'Transport service not found'
      });
    }

    // Check ownership
    if (transport.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to complete this transport service'
      });
    }

    // Check if transport is booked or in transit
    if (!['booked', 'in_transit'].includes(transport.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot complete a ${transport.status} transport service`
      });
    }

    await transport.completeTransport();

    res.json({
      success: true,
      message: 'Transport service marked as completed'
    });

  } catch (error) {
    console.error('Complete transport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing transport service',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Cancel transport booking
// @route   POST /api/transports/:id/cancel
// @access  Private (Owner or Booker)
exports.cancelTransport = async (req, res) => {
  try {
    const transport = await Transport.findById(req.params.id);

    if (!transport) {
      return res.status(404).json({
        success: false,
        message: 'Transport service not found'
      });
    }

    // Check authorization (owner or the user who booked it)
    const isOwner = transport.owner.toString() === req.user.id;
    const isBooker = transport.bookedBy?.toString() === req.user.id;
    
    if (!isOwner && !isBooker) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this booking'
      });
    }

    // Check if transport is booked
    if (transport.status !== 'booked') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${transport.status} transport service`
      });
    }

    await transport.cancelBooking();

    // If there was a listing, update it
    if (transport.bookedForListing) {
      const listing = await Listing.findById(transport.bookedForListing);
      if (listing) {
        listing.transportBooking = null;
        listing.requirements.needsTransport = true;
        await listing.save();
      }
    }

    res.json({
      success: true,
      message: 'Transport booking cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel transport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling transport booking',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete transport service
// @route   DELETE /api/transports/:id
// @access  Private (Owner or Admin)
exports.deleteTransport = async (req, res) => {
  try {
    const transport = await Transport.findById(req.params.id);

    if (!transport) {
      return res.status(404).json({
        success: false,
        message: 'Transport service not found'
      });
    }

    // Check ownership
    if (transport.owner.toString() !== req.user.id && !req.user.roles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this transport service'
      });
    }

    // Don't allow deletion if booked or in transit
    if (['booked', 'in_transit'].includes(transport.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete a ${transport.status} transport service`
      });
    }

    await transport.deleteOne();

    res.json({
      success: true,
      message: 'Transport service deleted successfully'
    });

  } catch (error) {
    console.error('Delete transport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting transport service',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
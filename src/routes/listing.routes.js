// @desc    Get marketplace listings (includes own listings)
// @route   GET /api/listings/marketplace
// @access  Private
exports.getMarketplaceListings = async (req, res) => {
  try {
    const { 
      lat, 
      lng, 
      maxDistance = 50000,
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

    // Use provided coordinates or user's coordinates
    let coordinates;
    if (lat && lng) {
      coordinates = [parseFloat(lng), parseFloat(lat)];
    } else {
      const user = await User.findById(req.user.id);
      coordinates = user.coordinates.coordinates;
    }

    // Build query for active listings within distance
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
      // Note: We don't exclude own listings here - marketplace shows everything
    };

    // Apply filters
    if (type) query.type = type;
    if (category) query.category = category;
    if (urgency) query.urgency = urgency;
    if (needsTransport) query['requirements.needsTransport'] = needsTransport === 'true';
    if (needsStorage) query['requirements.needsStorage'] = needsStorage === 'true';

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const listings = await Listing.find(query)
      .populate('owner', 'name roles averageRating profileStatus')
      .populate('transportBooking', 'title route')
      .populate('storageBooking', 'title locationDetails')
      .populate('matchedWith', 'name')
      .populate('matchedListing', 'title category')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Listing.countDocuments(query);

    // Calculate distances
    const user = await User.findById(req.user.id);
    const listingsWithDistance = listings.map(listing => {
      const listingObj = listing.toObject();
      
      if (user?.coordinates?.coordinates && listing.location?.coordinates) {
        listingObj.distance = calculateDistance(
          user.coordinates.coordinates[1], // lat
          user.coordinates.coordinates[0], // lng
          listing.location.coordinates[1], // listing lat
          listing.location.coordinates[0]  // listing lng
        );
      }
      
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
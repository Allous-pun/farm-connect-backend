const mongoose = require('mongoose');

const ListingSchema = new mongoose.Schema(
  {
    // ===============================
    // Basic Information
    // ===============================
    title: {
      type: String,
      required: [true, 'Please provide a title'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters']
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters']
    },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    // ===============================
    // Listing Type & Category (Only agricultural products)
    // ===============================
    type: {
      type: String,
      enum: ['surplus', 'need'], // Removed 'storage', 'transport'
      required: true
    },

    category: {
      type: String,
      enum: ['maize', 'milk', 'wheat', 'vegetables', 'fruits', 'livestock', 'other'],
      required: true
    },

    // ===============================
    // Product Details
    // ===============================
    productDetails: {
      quantity: {
        type: Number,
        required: true,
        min: 0
      },
      unit: {
        type: String,
        enum: ['kg', 'liters', 'bags', 'tons', 'units', 'crates', 'other'],
        required: true
      },
      quality: {
        type: String,
        enum: ['grade_a', 'grade_b', 'grade_c', 'mixed', 'not_specified'],
        default: 'not_specified'
      },
      harvestDate: {
        type: Date
      },
      packaging: {
        type: String,
        trim: true
      },
      shelfLife: {
        type: Number // in days
      }
    },

    // ===============================
    // Price Information
    // ===============================
    price: {
      amount: {
        type: Number,
        min: 0
      },
      currency: {
        type: String,
        default: 'KES'
      },
      isNegotiable: {
        type: Boolean,
        default: false
      },
      priceType: {
        type: String,
        enum: ['fixed', 'per_unit', 'negotiable', 'not_specified'],
        default: 'not_specified'
      }
    },

    // ===============================
    // Location Information
    // ===============================
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
        validate: {
          validator: function (val) {
            return val.length === 2 && val.every((v) => typeof v === 'number');
          },
          message: 'Coordinates must be an array of two numbers [lng, lat]'
        }
      }
    },

    locationDetails: {
      county: {
        type: String,
        trim: true
      },
      subCounty: {
        type: String,
        trim: true
      },
      ward: {
        type: String,
        trim: true
      },
      landmark: {
        type: String,
        trim: true
      },
      address: {
        type: String,
        trim: true
      }
    },

    // ===============================
    // Transport & Storage Requirements
    // ===============================
    requirements: {
      needsTransport: {
        type: Boolean,
        default: false
      },
      needsStorage: {
        type: Boolean,
        default: false
      },
      transportDistance: {
        type: Number // in km
      },
      storageDuration: {
        type: Number // in days
      },
      specialRequirements: {
        type: String,
        trim: true
      }
    },

    // ===============================
    // Status & Lifecycle
    // ===============================
    status: {
      type: String,
      enum: ['active', 'matched', 'closed', 'expired'],
      default: 'active'
    },

    urgency: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },

    visibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'public'
    },

    // ===============================
    // Time-based Fields
    // ===============================
    expiryDate: {
      type: Date,
      required: true,
      default: function() {
        // Default expiry: 7 days from creation
        const date = new Date();
        date.setDate(date.getDate() + 7);
        return date;
      }
    },

    matchedAt: {
      type: Date
    },

    closedAt: {
      type: Date
    },

    // ===============================
    // Service Matches
    // ===============================
    matchedWith: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    matchedListing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing'
    },

    // ===============================
    // Service Bookings (for transport/storage)
    // ===============================
    transportBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transport'
    },

    storageBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Storage'
    },

    // ===============================
    // Interaction Tracking
    // ===============================
    viewCount: {
      type: Number,
      default: 0
    },

    chatCount: {
      type: Number,
      default: 0
    },

    // ===============================
    // Metadata
    // ===============================
    tags: [{
      type: String,
      trim: true
    }],

    images: [{
      url: {
        type: String,
        required: true
      },
      thumbnailUrl: {
        type: String,
        required: true
      },
      caption: {
        type: String,
        trim: true,
        maxlength: [100, 'Caption cannot exceed 100 characters']
      },
      isPrimary: {
        type: Boolean,
        default: false
      },
      order: {
        type: Number,
        default: 0,
        min: 0,
        max: 3
      },
      uploadedAt: {
        type: Date,
        default: Date.now
      }
    }],

    isFeatured: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ===============================
// Indexes (Section 5)
// ===============================
ListingSchema.index({ location: '2dsphere' });
ListingSchema.index({ status: 1, type: 1, createdAt: -1 });
ListingSchema.index({ owner: 1, status: 1, createdAt: -1 });
ListingSchema.index({ category: 1, status: 1, urgency: 1 });
ListingSchema.index({ expiryDate: 1, status: 1 });
ListingSchema.index({ 'requirements.needsTransport': 1, status: 1 });
ListingSchema.index({ 'requirements.needsStorage': 1, status: 1 });

// ===============================
// Virtuals
// ===============================
ListingSchema.virtual('isExpired').get(function() {
  return new Date() > this.expiryDate;
});

ListingSchema.virtual('timeRemaining').get(function() {
  const now = new Date();
  const remaining = this.expiryDate - now;
  return remaining > 0 ? Math.ceil(remaining / (1000 * 60 * 60 * 24)) : 0;
});

ListingSchema.virtual('formattedLocation').get(function() {
  const parts = [];
  if (this.locationDetails?.ward) parts.push(this.locationDetails.ward);
  if (this.locationDetails?.subCounty) parts.push(this.locationDetails.subCounty);
  if (this.locationDetails?.county) parts.push(this.locationDetails.county);
  return parts.length ? parts.join(', ') : 'Location not specified';
});

ListingSchema.virtual('primaryImage').get(function() {
  if (!this.images || !Array.isArray(this.images)) {
    return null;
  }
  
  const primary = this.images.find(img => img.isPrimary);
  if (primary) return primary;
  
  return this.images.length > 0 ? this.images[0] : null;
});

// ===============================
// Methods
// ===============================
ListingSchema.methods.incrementViewCount = function() {
  this.viewCount += 1;
  return this.save();
};

ListingSchema.methods.incrementChatCount = function() {
  this.chatCount += 1;
  return this.save();
};

ListingSchema.methods.markAsMatched = function(matchedUserId, matchedListingId) {
  this.status = 'matched';
  this.matchedWith = matchedUserId;
  this.matchedListing = matchedListingId;
  this.matchedAt = new Date();
  return this.save();
};

ListingSchema.methods.bookTransport = function(transportId) {
  this.transportBooking = transportId;
  this.requirements.needsTransport = false; // Mark as fulfilled
  return this.save();
};

ListingSchema.methods.bookStorage = function(storageId) {
  this.storageBooking = storageId;
  this.requirements.needsStorage = false; // Mark as fulfilled
  return this.save();
};

ListingSchema.methods.markAsClosed = function() {
  this.status = 'closed';
  this.closedAt = new Date();
  return this.save();
};

ListingSchema.methods.addImage = async function(imageData) {
  if (!this.images) {
    this.images = [];
  }
  
  if (this.images.length >= 4) {
    throw new Error('Maximum of 4 images allowed per listing');
  }
  
  if (this.images.length === 0) {
    imageData.isPrimary = true;
  }
  
  imageData.order = this.images.length;
  
  this.images.push(imageData);
  return this.save();
};

// ===============================
// Static Methods
// ===============================
ListingSchema.statics.findNearby = function(coordinates, maxDistance = 20000) {
  return this.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: maxDistance
      }
    },
    status: 'active',
    expiryDate: { $gt: new Date() }
  });
};

ListingSchema.statics.findActiveByOwner = function(ownerId, category = null) {
  const query = {
    owner: ownerId,
    status: 'active',
    expiryDate: { $gt: new Date() }
  };
  
  if (category) {
    query.category = category;
  }
  
  return this.find(query);
};

ListingSchema.statics.findNeedingTransport = function(county = null) {
  const query = {
    'requirements.needsTransport': true,
    status: 'active',
    expiryDate: { $gt: new Date() }
  };

  if (county) {
    query['locationDetails.county'] = { $regex: county, $options: 'i' };
  }

  return this.find(query);
};

ListingSchema.statics.findNeedingStorage = function(county = null) {
  const query = {
    'requirements.needsStorage': true,
    status: 'active',
    expiryDate: { $gt: new Date() }
  };

  if (county) {
    query['locationDetails.county'] = { $regex: county, $options: 'i' };
  }

  return this.find(query);
};

// ===============================
// Middleware
// ===============================
ListingSchema.pre('save', function(next) {
  if (this.isExpired && this.status !== 'expired') {
    this.status = 'expired';
  }
  next();
});

module.exports = mongoose.model('Listing', ListingSchema);
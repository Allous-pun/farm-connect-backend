const mongoose = require('mongoose');

const TransportSchema = new mongoose.Schema(
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
    // Transport Type
    // ===============================
    serviceType: {
      type: String,
      enum: ['local', 'inter-county', 'national', 'refrigerated', 'urgent'],
      required: true
    },

    // ===============================
    // Vehicle Details
    // ===============================
    vehicleDetails: {
      vehicleType: {
        type: String,
        enum: ['truck', 'van', 'pickup', 'lorry', 'refrigerated', 'motorcycle', 'other'],
        required: true
      },
      capacity: {
        type: Number, // in kg
        required: true,
        min: 0
      },
      licensePlate: {
        type: String,
        trim: true
      },
      insurance: {
        type: Boolean,
        default: false
      },
      refrigeration: {
        type: Boolean,
        default: false
      },
      safetyFeatures: [{
        type: String,
        trim: true
      }]
    },

    // ===============================
    // Route Information
    // ===============================
    route: {
      from: {
        county: {
          type: String,
          required: true,
          trim: true
        },
        subCounty: {
          type: String,
          trim: true
        },
        coordinates: {
          type: [Number], // [lng, lat]
          required: true
        }
      },
      to: {
        county: {
          type: String,
          required: true,
          trim: true
        },
        subCounty: {
          type: String,
          trim: true
        },
        coordinates: {
          type: [Number], // [lng, lat]
          required: true
        }
      },
      via: [{
        county: {
          type: String,
          trim: true
        },
        coordinates: {
          type: [Number] // [lng, lat]
        }
      }]
    },

    // ===============================
    // Availability & Schedule
    // ===============================
    availability: {
      type: String,
      enum: ['immediate', 'scheduled', 'recurring'],
      default: 'immediate'
    },

    schedule: {
      startDate: {
        type: Date
      },
      endDate: {
        type: Date
      },
      recurrence: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'once']
      }
    },

    // ===============================
    // Pricing
    // ===============================
    pricing: {
      amount: {
        type: Number,
        required: true,
        min: 0
      },
      currency: {
        type: String,
        default: 'KES'
      },
      pricingType: {
        type: String,
        enum: ['per_km', 'per_kg', 'per_trip', 'fixed'],
        required: true
      },
      isNegotiable: {
        type: Boolean,
        default: false
      },
      estimatedDistance: {
        type: Number, // in km
        min: 0
      }
    },

    // ===============================
    // Cargo Requirements
    // ===============================
    cargoRequirements: {
      acceptedCargoTypes: [{
        type: String,
        enum: ['agricultural', 'livestock', 'perishable', 'packaged', 'machinery', 'other']
      }],
      maxWeight: {
        type: Number, // in kg
        required: true
      },
      maxVolume: {
        type: String // e.g., "100 cubic meters"
      },
      temperatureRequirements: {
        minTemp: Number,
        maxTemp: Number
      },
      specialHandling: [{
        type: String,
        trim: true
      }]
    },

    // ===============================
    // Status & Lifecycle
    // ===============================
    status: {
      type: String,
      enum: ['available', 'booked', 'in_transit', 'completed', 'cancelled'],
      default: 'available'
    },

    urgency: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },

    // ===============================
    // Time-based Fields
    // ===============================
    expiryDate: {
      type: Date,
      default: function() {
        // Default expiry: 30 days for transport services
        const date = new Date();
        date.setDate(date.getDate() + 30);
        return date;
      }
    },

    bookedAt: {
      type: Date
    },

    completedAt: {
      type: Date
    },

    // ===============================
    // Matching & Booking
    // ===============================
    bookedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },

    bookedForListing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing'
    },

    // ===============================
    // Interaction Tracking
    // ===============================
    viewCount: {
      type: Number,
      default: 0
    },

    inquiryCount: {
      type: Number,
      default: 0
    },

    // ===============================
    // Ratings & Reviews
    // ===============================
    rating: {
      average: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
      },
      count: {
        type: Number,
        default: 0
      }
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
      caption: {
        type: String,
        trim: true
      },
      isVehicleImage: {
        type: Boolean,
        default: true
      }
    }],

    isFeatured: {
      type: Boolean,
      default: false
    },

    // ===============================
    // Verification
    // ===============================
    isVerified: {
      type: Boolean,
      default: false
    },

    verificationDetails: {
      licenseVerified: {
        type: Boolean,
        default: false
      },
      insuranceVerified: {
        type: Boolean,
        default: false
      },
      vehicleVerified: {
        type: Boolean,
        default: false
      }
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// ===============================
// Indexes
// ===============================
TransportSchema.index({ 'route.from.county': 1, 'route.to.county': 1 });
TransportSchema.index({ 'vehicleDetails.vehicleType': 1, status: 1 });
TransportSchema.index({ owner: 1, status: 1 });
TransportSchema.index({ 'route.from.coordinates': '2dsphere' });
TransportSchema.index({ 'route.to.coordinates': '2dsphere' });
TransportSchema.index({ expiryDate: 1, status: 1 });

// ===============================
// Virtuals
// ===============================
TransportSchema.virtual('isExpired').get(function() {
  return new Date() > this.expiryDate;
});

TransportSchema.virtual('isAvailable').get(function() {
  return this.status === 'available' && !this.isExpired;
});

TransportSchema.virtual('estimatedPrice').get(function() {
  if (this.pricing.pricingType === 'per_km' && this.pricing.estimatedDistance) {
    return this.pricing.amount * this.pricing.estimatedDistance;
  }
  return this.pricing.amount;
});

// ===============================
// Methods
// ===============================
TransportSchema.methods.incrementViewCount = function() {
  this.viewCount += 1;
  return this.save();
};

TransportSchema.methods.incrementInquiryCount = function() {
  this.inquiryCount += 1;
  return this.save();
};

TransportSchema.methods.bookTransport = function(userId, listingId) {
  this.status = 'booked';
  this.bookedBy = userId;
  this.bookedForListing = listingId;
  this.bookedAt = new Date();
  return this.save();
};

TransportSchema.methods.completeTransport = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  return this.save();
};

TransportSchema.methods.cancelBooking = function() {
  this.status = 'available';
  this.bookedBy = null;
  this.bookedForListing = null;
  this.bookedAt = null;
  return this.save();
};

// ===============================
// Static Methods
// ===============================
TransportSchema.statics.findAvailable = function(fromCounty = null, toCounty = null) {
  const query = {
    status: 'available',
    expiryDate: { $gt: new Date() }
  };

  if (fromCounty) {
    query['route.from.county'] = { $regex: fromCounty, $options: 'i' };
  }

  if (toCounty) {
    query['route.to.county'] = { $regex: toCounty, $options: 'i' };
  }

  return this.find(query);
};

TransportSchema.statics.findByRoute = function(fromCoords, toCoords, maxDistance = 50000) {
  return this.find({
    'route.from.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: fromCoords
        },
        $maxDistance: maxDistance
      }
    },
    'route.to.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: toCoords
        },
        $maxDistance: maxDistance
      }
    },
    status: 'available',
    expiryDate: { $gt: new Date() }
  });
};

module.exports = mongoose.model('Transport', TransportSchema);
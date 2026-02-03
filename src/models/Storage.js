const mongoose = require('mongoose');

const StorageSchema = new mongoose.Schema(
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
    // Storage Type
    // ===============================
    facilityType: {
      type: String,
      enum: ['warehouse', 'cold-storage', 'silo', 'barn', 'container', 'refrigerated_container', 'other'],
      required: true
    },

    // ===============================
    // Facility Details
    // ===============================
    facilityDetails: {
      totalCapacity: {
        type: Number, // in kg
        required: true,
        min: 0
      },
      availableCapacity: {
        type: Number, // in kg
        required: true,
        min: 0
      },
      dimensions: {
        length: Number, // in meters
        width: Number, // in meters
        height: Number, // in meters
        area: Number // in square meters
      },
      temperatureControlled: {
        type: Boolean,
        default: false
      },
      temperatureRange: {
        min: Number, // in °C
        max: Number  // in °C
      },
      humidityControl: {
        type: Boolean,
        default: false
      },
      securityFeatures: [{
        type: String,
        enum: ['cctv', 'alarm', 'guards', 'fenced', 'access_control']
      }]
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
        required: true
      }
    },

    locationDetails: {
      county: {
        type: String,
        required: true,
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
      address: {
        type: String,
        trim: true
      },
      accessibility: {
        type: String,
        enum: ['excellent', 'good', 'fair', 'poor']
      }
    },

    // ===============================
    // Services Offered
    // ===============================
    services: [{
      type: String,
      enum: ['storage', 'packaging', 'sorting', 'grading', 'drying', 'fumigation', 'loading', 'unloading', 'inspection']
    }],

    // ===============================
    // Pricing & Terms
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
        enum: ['per_day', 'per_week', 'per_month', 'per_kg_per_day', 'fixed'],
        required: true
      },
      minimumPeriod: {
        type: Number, // in days
        default: 1
      },
      isNegotiable: {
        type: Boolean,
        default: false
      },
      depositRequired: {
        type: Boolean,
        default: false
      },
      depositAmount: {
        type: Number,
        min: 0
      }
    },

    // ===============================
    // Product Requirements
    // ===============================
    acceptedProducts: [{
      type: String,
      enum: ['grains', 'vegetables', 'fruits', 'dairy', 'meat', 'processed', 'livestock_feed', 'fertilizer', 'other']
    }],

    productRestrictions: {
      maxMoistureContent: Number, // percentage
      requiresPackaging: Boolean,
      prohibitedItems: [{
        type: String,
        trim: true
      }]
    },

    // ===============================
    // Availability & Booking
    // ===============================
    availability: {
      type: String,
      enum: ['available', 'partially_available', 'fully_booked'],
      default: 'available'
    },

    bookingType: {
      type: String,
      enum: ['immediate', 'reservation', 'both'],
      default: 'both'
    },

    // ===============================
    // Status & Lifecycle
    // ===============================
    status: {
      type: String,
      enum: ['active', 'booked', 'maintenance', 'closed'],
      default: 'active'
    },

    // ===============================
    // Time-based Fields
    // ===============================
    expiryDate: {
      type: Date,
      default: function() {
        // Default expiry: 90 days for storage listings
        const date = new Date();
        date.setDate(date.getDate() + 90);
        return date;
      }
    },

    bookedUntil: {
      type: Date
    },

    // ===============================
    // Current Bookings
    // ===============================
    currentBookings: [{
      bookedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      product: {
        type: String,
        required: true
      },
      quantity: {
        type: Number,
        required: true,
        min: 0
      },
      startDate: {
        type: Date,
        required: true
      },
      endDate: {
        type: Date,
        required: true
      },
      status: {
        type: String,
        enum: ['active', 'completed', 'cancelled'],
        default: 'active'
      }
    }],

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
      imageType: {
        type: String,
        enum: ['facility', 'interior', 'equipment', 'security']
      }
    }],

    isFeatured: {
      type: Boolean,
      default: false
    },

    // ===============================
    // Verification & Certifications
    // ===============================
    isVerified: {
      type: Boolean,
      default: false
    },

    certifications: [{
      type: String,
      trim: true
    }],

    inspectionReports: [{
      date: Date,
      inspector: String,
      status: String,
      reportUrl: String
    }]
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
StorageSchema.index({ location: '2dsphere' });
StorageSchema.index({ 'locationDetails.county': 1, availability: 1 });
StorageSchema.index({ facilityType: 1, 'facilityDetails.temperatureControlled': 1 });
StorageSchema.index({ acceptedProducts: 1, status: 1 });
StorageSchema.index({ owner: 1, status: 1 });
StorageSchema.index({ expiryDate: 1 });

// ===============================
// Virtuals
// ===============================
StorageSchema.virtual('isExpired').get(function() {
  return new Date() > this.expiryDate;
});

StorageSchema.virtual('utilizationRate').get(function() {
  if (this.facilityDetails.totalCapacity === 0) return 0;
  const used = this.facilityDetails.totalCapacity - this.facilityDetails.availableCapacity;
  return (used / this.facilityDetails.totalCapacity) * 100;
});

StorageSchema.virtual('hasCapacity').get(function() {
  return this.facilityDetails.availableCapacity > 0 && this.status === 'active';
});

// ===============================
// Methods
// ===============================
StorageSchema.methods.incrementViewCount = function() {
  this.viewCount += 1;
  return this.save();
};

StorageSchema.methods.incrementInquiryCount = function() {
  this.inquiryCount += 1;
  return this.save();
};

StorageSchema.methods.bookStorage = function(bookingData) {
  // Calculate new available capacity
  const newAvailableCapacity = this.facilityDetails.availableCapacity - bookingData.quantity;
  
  if (newAvailableCapacity < 0) {
    throw new Error('Insufficient capacity available');
  }

  // Update available capacity
  this.facilityDetails.availableCapacity = newAvailableCapacity;
  
  // Update availability status
  if (this.facilityDetails.availableCapacity === 0) {
    this.availability = 'fully_booked';
  } else if (this.facilityDetails.availableCapacity < this.facilityDetails.totalCapacity * 0.5) {
    this.availability = 'partially_available';
  }

  // Add booking
  this.currentBookings.push(bookingData);
  
  return this.save();
};

StorageSchema.methods.releaseStorage = function(bookingId, quantity) {
  // Find and update booking
  const booking = this.currentBookings.id(bookingId);
  if (!booking) {
    throw new Error('Booking not found');
  }

  booking.status = 'completed';
  
  // Release capacity
  this.facilityDetails.availableCapacity += quantity;
  
  // Update availability status
  if (this.facilityDetails.availableCapacity > 0) {
    this.availability = 'available';
  }

  return this.save();
};

// ===============================
// Static Methods
// ===============================
StorageSchema.statics.findAvailableByLocation = function(county, maxDistance = 50000, coords = null) {
  const query = {
    availability: { $in: ['available', 'partially_available'] },
    status: 'active',
    expiryDate: { $gt: new Date() }
  };

  if (coords) {
    query.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coords
        },
        $maxDistance: maxDistance
      }
    };
  } else if (county) {
    query['locationDetails.county'] = { $regex: county, $options: 'i' };
  }

  return this.find(query);
};

StorageSchema.statics.findByProductType = function(productType, county = null) {
  const query = {
    acceptedProducts: productType,
    availability: { $in: ['available', 'partially_available'] },
    status: 'active'
  };

  if (county) {
    query['locationDetails.county'] = { $regex: county, $options: 'i' };
  }

  return this.find(query);
};

module.exports = mongoose.model('Storage', StorageSchema);
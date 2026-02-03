const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const COUNTY_COORDS = {
  Nairobi: [36.8172, -1.2864],
  Mombasa: [39.6682, -4.0435],
  Kisumu: [34.7617, -0.0917],
  Nakuru: [36.0667, -0.3031],
  Eldoret: [35.2698, 0.5143],
  Thika: [37.0736, -1.0330],
  Kakamega: [34.7500, 0.2833],
  Kisii: [34.7833, -0.6833],
  Meru: [37.6493, 0.0471],
  Nyeri: [36.9478, -0.4167],
  Machakos: [37.2667, -1.5167],
  Kiambu: [36.8356, -1.1711],
  Muranga: [37.1500, -0.7833],
  Kirinyaga: [37.2833, -0.6833],
  Nyandarua: [36.3833, -0.5333],
  Laikipia: [36.8333, 0.4167],
  Narok: [35.8667, -1.0833],
  Kajiado: [36.7833, -1.8333],
  Makueni: [37.6333, -1.8167],
  Kitui: [38.0167, -1.3667],
  Garissa: [39.6500, -0.4500],
  Wajir: [40.0667, 1.7500],
  Mandera: [41.8500, 3.9333],
  Marsabit: [36.9167, 2.3333],
  Isiolo: [37.5833, 0.3500],
  Lamu: [40.9000, -2.2667],
  TanaRiver: [40.1167, -1.2000],
  Kilifi: [39.8500, -3.6333],
  Kwale: [39.4167, -4.1833],
  "Taita Taveta": [38.3667, -3.3667],
  Busia: [34.1000, 0.4500],
  Siaya: [34.2833, 0.0667],
  "Homa Bay": [34.6333, -0.5333],
  Migori: [34.4667, -1.0667],
  Bomet: [35.3500, -0.7667],
  Kericho: [35.2833, -0.3667],
  Bungoma: [34.5667, 0.5667],
  Vihiga: [34.7333, 0.0833],
  "Trans Nzoia": [35.0000, 1.0333],
  "Uasin Gishu": [35.2833, 0.5167],
  "Elgeyo Marakwet": [35.5667, 0.6333],
  Nandi: [35.1000, 0.1333],
  Baringo: [35.9833, 0.5000],
  Samburu: [37.5167, 0.5333],
  Turkana: [36.0000, 3.1000],
  "West Pokot": [35.5000, 1.2333],
};

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
    },

    phone: { type: String, trim: true, sparse: true },

    password: { type: String, required: [true, 'Please provide a password'], minlength: 6, select: false },

    name: { type: String, required: [true, 'Please provide your name'], trim: true },

    roles: {
      type: [String],
      enum: ['farmer', 'transport', 'storage', 'admin'],
      default: ['farmer'],
      required: true,
    },

    // ===============================
    // Location info
    // ===============================
    location: {
      name: { type: String, trim: true },
      address: {
        county: { type: String, trim: true },
        subCounty: { type: String, trim: true },
        ward: { type: String, trim: true },
        town: { type: String, trim: true },
        street: { type: String, trim: true },
      },
      landmark: { type: String, trim: true },
    },

    // ===============================
    // GeoJSON coordinates
    // ===============================
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
        default: COUNTY_COORDS['Nairobi'],
        validate: {
          validator: function (val) {
            return val.length === 2 && val.every((v) => typeof v === 'number');
          },
          message: 'Coordinates must be an array of two numbers [lng, lat]',
        },
      },
    },

    profileStatus: {
      type: String,
      enum: ['active', 'pending', 'suspended', 'verified'],
      default: 'active',
    },

    isVerified: { type: Boolean, default: false },

    // Bio field
    bio: {
      type: String,
      trim: true,
      maxlength: 500
    },

    // Role-specific information
    roleSpecificInfo: {
      // For farmers
      farmer: {
        farmSize: {
          type: String,
          trim: true
        },
        mainCrops: [{
          type: String,
          trim: true
        }],
        equipment: [{
          type: String,
          trim: true
        }],
        yearsFarming: {
          type: Number,
          min: 0
        },
        certifications: [{
          type: String,
          trim: true
        }],
        farmType: {
          type: String,
          enum: ['small-scale', 'medium-scale', 'large-scale', 'cooperative'],
          trim: true
        }
      },
      
      // For transporters
      transport: {
        vehicleType: {
          type: String,
          enum: ['truck', 'van', 'pickup', 'lorry', 'refrigerated', 'motorcycle', 'other'],
          trim: true
        },
        capacity: {
          type: Number, // in kg
          min: 0
        },
        licensePlate: {
          type: String,
          trim: true
        },
        availability: {
          type: Boolean,
          default: true
        },
        serviceAreas: [{
          type: String,
          trim: true
        }],
        refrigeration: {
          type: Boolean,
          default: false
        },
        insurance: {
          type: Boolean,
          default: false
        },
        licenseNumber: {
          type: String,
          trim: true
        }
      },
      
      // For storage providers
      storage: {
        facilityType: {
          type: String,
          enum: ['warehouse', 'cold-storage', 'silo', 'barn', 'container', 'other'],
          trim: true
        },
        totalCapacity: {
          type: Number, // in kg
          min: 0
        },
        availableCapacity: {
          type: Number,
          min: 0
        },
        temperatureControlled: {
          type: Boolean,
          default: false
        },
        temperatureRange: {
          min: { type: Number },
          max: { type: Number }
        },
        securityFeatures: [{
          type: String,
          trim: true
        }],
        services: [{
          type: String,
          enum: ['storage', 'packaging', 'sorting', 'grading', 'drying', 'fumigation'],
          trim: true
        }],
        certifications: [{
          type: String,
          trim: true
        }]
      }
    },

    // Ratings system
    ratings: [{
      id: {
        type: String,
        required: true
      },
      fromUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
      },
      comment: {
        type: String,
        trim: true,
        maxlength: 500
      },
      date: {
        type: Date,
        default: Date.now
      },
      roleContext: {  // Which role was being rated (if user has multiple)
        type: String,
        enum: ['farmer', 'transport', 'storage']
      }
    }],

    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },

    // Role-specific average ratings
    roleRatings: {
      farmer: {
        average: { type: Number, default: 0, min: 0, max: 5 },
        count: { type: Number, default: 0 }
      },
      transport: {
        average: { type: Number, default: 0, min: 0, max: 5 },
        count: { type: Number, default: 0 }
      },
      storage: {
        average: { type: Number, default: 0, min: 0, max: 5 },
        count: { type: Number, default: 0 }
      }
    },

    // Transaction history
    transactions: [{
      id: {
        type: String,
        required: true
      },
      type: {
        type: String,
        enum: ['sale', 'purchase', 'transport', 'storage'],
        required: true
      },
      product: {
        type: String,
        required: true
      },
      quantity: {
        type: Number,
        required: true
      },
      unit: {
        type: String,
        required: true
      },
      price: {
        type: Number,
        required: true
      },
      date: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['pending', 'completed', 'cancelled'],
        default: 'completed'
      },
      roleInvolved: {
        type: String,
        enum: ['farmer', 'transport', 'storage']
      }
    }],

    // ===============================
    // Listing references
    // ===============================
    activeListings: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing'
    }],

    closedListings: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing'
    }],

    totalTransactions: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

// 2dsphere index for GeoJSON queries
UserSchema.index({ coordinates: '2dsphere' });

// Index for role-based queries
UserSchema.index({ roles: 1 });
UserSchema.index({ 'roleSpecificInfo.transport.availability': 1 });
UserSchema.index({ 'roleSpecificInfo.storage.availableCapacity': 1 });

// Password hashing
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Password comparison
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Role-specific methods
UserSchema.methods.hasRole = function(role) {
  return this.roles.includes(role);
};

UserSchema.methods.getRoleInfo = function(role) {
  return this.roleSpecificInfo ? this.roleSpecificInfo[role] : null;
};

UserSchema.methods.updateRoleInfo = function(role, data) {
  if (!this.roleSpecificInfo) {
    this.roleSpecificInfo = {};
  }
  this.roleSpecificInfo[role] = { ...this.roleSpecificInfo[role], ...data };
  return this.save();
};

// Add rating with role context
UserSchema.methods.addRating = async function(ratingData) {
  const newRating = {
    id: `r-${Date.now()}`,
    fromUserId: ratingData.fromUserId,
    rating: ratingData.rating,
    comment: ratingData.comment || '',
    date: new Date(),
    roleContext: ratingData.roleContext || null
  };

  this.ratings.push(newRating);

  // Update overall average rating
  const totalRatings = this.ratings.length;
  const sumRatings = this.ratings.reduce((sum, r) => sum + r.rating, 0);
  this.averageRating = sumRatings / totalRatings;

  // Update role-specific rating if roleContext provided
  if (ratingData.roleContext && ['farmer', 'transport', 'storage'].includes(ratingData.roleContext)) {
    const role = ratingData.roleContext;
    const roleRatings = this.ratings.filter(r => r.roleContext === role);
    
    if (roleRatings.length > 0) {
      const roleSum = roleRatings.reduce((sum, r) => sum + r.rating, 0);
      this.roleRatings[role].average = roleSum / roleRatings.length;
      this.roleRatings[role].count = roleRatings.length;
    }
  }

  await this.save();
  return newRating;
};

// Listing helpers
UserSchema.methods.addListing = async function(listingId) {
  this.activeListings.push(listingId);
  await this.save();
};

UserSchema.methods.closeListing = async function(listingId) {
  const index = this.activeListings.indexOf(listingId);
  if (index > -1) {
    this.activeListings.splice(index, 1);
    this.closedListings.push(listingId);
    await this.save();
  }
};

// Virtual: formatted location
UserSchema.virtual('formattedLocation').get(function () {
  if (this.location?.name) return this.location.name;

  const parts = [];
  if (this.location?.address?.town) parts.push(this.location.address.town);
  if (this.location?.address?.county) parts.push(this.location.address.county);
  return parts.length ? parts.join(', ') : 'Location not specified';
});

// Virtual: primary role (first role in array)
UserSchema.virtual('primaryRole').get(function () {
  return this.roles[0] || 'farmer';
});

module.exports = mongoose.model('User', UserSchema);
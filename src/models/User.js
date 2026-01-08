const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  phone: {
    type: String,
    trim: true,
    sparse: true
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false
  },
  name: {
    type: String,
    required: [true, 'Please provide your name'],
    trim: true
  },
  roles: {
    type: [String],
    enum: ['farmer', 'transport', 'storage', 'admin'],
    default: ['farmer'],
    required: true
  },
  // Location Information
  location: {
    // Display name - e.g., "Nairobi, Kenya", "Karen"
    name: {
      type: String,
      trim: true
    },
    // Coordinates for map display and geospatial queries
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [36.8172, -1.2864] // Default to Kenya coordinates
      }
    },
    // Address details
    address: {
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
      town: {
        type: String,
        trim: true
      },
      street: {
        type: String,
        trim: true
      }
    },
    // For places that don't have proper addressing
    landmark: {
      type: String,
      trim: true
    }
  },
  profileStatus: {
    type: String,
    enum: ['active', 'pending', 'suspended', 'verified'],
    default: 'active'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Geospatial index for location queries
UserSchema.index({ 'location.coordinates': '2dsphere' });

// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Update timestamp on save
UserSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compare password method
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Virtual for formatted location
UserSchema.virtual('formattedLocation').get(function() {
  if (this.location.name) return this.location.name;
  
  const parts = [];
  if (this.location.address?.county) parts.push(this.location.address.county);
  if (this.location.address?.town) parts.push(this.location.address.town);
  if (this.location.address?.subCounty) parts.push(this.location.address.subCounty);
  
  return parts.length > 0 ? parts.join(', ') : 'Location not specified';
});

module.exports = mongoose.model('User', UserSchema);
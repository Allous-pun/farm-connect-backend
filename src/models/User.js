const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
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

    // ===============================
    // Location display & address info
    // ===============================
    location: {
      name: {
        type: String,
        trim: true
      },
      address: {
        county: { type: String, trim: true },
        subCounty: { type: String, trim: true },
        ward: { type: String, trim: true },
        town: { type: String, trim: true },
        street: { type: String, trim: true }
      },
      landmark: {
        type: String,
        trim: true
      }
    },

    // ===============================
    // GeoJSON coordinates (CRITICAL)
    // ===============================
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
        required: true
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
        default: [36.8172, -1.2864] // Nairobi fallback
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
    }
  },
  {
    timestamps: true // ✅ FIXED updatedAt / createdAt
  }
);

// ===============================
// Geo index (MANDATORY)
// ===============================
UserSchema.index({ coordinates: '2dsphere' });

// ===============================
// Password hashing
// ===============================
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ===============================
// Password comparison
// ===============================
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ===============================
// Virtual: formatted location
// ===============================
UserSchema.virtual('formattedLocation').get(function () {
  if (this.location?.name) return this.location.name;

  const parts = [];
  if (this.location?.address?.town) parts.push(this.location.address.town);
  if (this.location?.address?.county) parts.push(this.location.address.county);

  return parts.length ? parts.join(', ') : 'Location not specified';
});

module.exports = mongoose.model('User', UserSchema);

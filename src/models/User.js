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
  },
  { timestamps: true }
);

// 2dsphere index for GeoJSON queries
UserSchema.index({ coordinates: '2dsphere' });

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

// Virtual: formatted location
UserSchema.virtual('formattedLocation').get(function () {
  if (this.location?.name) return this.location.name;

  const parts = [];
  if (this.location?.address?.town) parts.push(this.location.address.town);
  if (this.location?.address?.county) parts.push(this.location.address.county);
  return parts.length ? parts.join(', ') : 'Location not specified';
});

module.exports = mongoose.model('User', UserSchema);

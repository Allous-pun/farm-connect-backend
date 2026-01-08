const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { validationResult } = require('express-validator');

/**
 * Fallback coordinates for Kenya counties / major areas
 * Format: [lng, lat]
 * (Used when users don’t know GPS)
 */
const COUNTY_COORDS = {
  Nairobi: [36.8172, -1.2864],
  Kiambu: [36.8356, -1.1711],
  Nakuru: [36.0667, -0.3031],
  Kisumu: [34.7617, -0.0917],
  Mombasa: [39.6682, -4.0435],
  Eldoret: [35.2698, 0.5143],
};

/**
 * Normalize ALL location inputs into:
 * {
 *   location: {...},
 *   coordinates: { type: 'Point', coordinates: [lng, lat] }
 * }
 */
const parseLocationData = (location) => {
  // Default GeoJSON (never invalid)
  let coordinates = {
    type: 'Point',
    coordinates: [36.8172, -1.2864], // Nairobi fallback
  };

  let locationData = {};

  if (!location) {
    return { location: locationData, coordinates };
  }

  /**
   * CASE 1: React Leaflet / GPS
   * { lat, lng, name?, county?, town? }
   */
  if (
    typeof location === 'object' &&
    typeof location.lat === 'number' &&
    typeof location.lng === 'number'
  ) {
    coordinates.coordinates = [
      Number(location.lng),
      Number(location.lat),
    ];

    locationData = {
      name: location.name || 'Your Location',
      address: {
        county: location.county,
        subCounty: location.subCounty,
        ward: location.ward,
        town: location.town,
        street: location.street,
      },
      landmark: location.landmark,
    };

    return { location: locationData, coordinates };
  }

  /**
   * CASE 2: County / town only (NO GPS)
   */
  if (typeof location === 'object' && location.county) {
    const fallback = COUNTY_COORDS[location.county];
    if (fallback) coordinates.coordinates = fallback;

    locationData = {
      name: location.county,
      address: {
        county: location.county,
        town: location.town,
      },
    };

    return { location: locationData, coordinates };
  }

  /**
   * CASE 3: Simple string ("Nairobi", "Kisumu")
   */
  if (typeof location === 'string') {
    const fallback = COUNTY_COORDS[location];
    if (fallback) coordinates.coordinates = fallback;

    locationData = { name: location };
    return { location: locationData, coordinates };
  }

  // Never trust client-provided GeoJSON
  return { location: {}, coordinates };
};

/* ======================================================
   REGISTER
====================================================== */
const register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name, phone, roles, location } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email',
      });
    }

    const { location: loc, coordinates } = parseLocationData(location);

    const user = await User.create({
      email,
      password,
      name,
      phone,
      roles: roles || ['farmer'],
      location: loc,
      coordinates,
    });

    const token = generateToken(user._id, user.roles);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles: user.roles,
        location: {
          name: user.location?.name,
          coordinates: user.coordinates.coordinates,
          county: user.location?.address?.county,
          town: user.location?.address?.town,
        },
        profileStatus: user.profileStatus,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ======================================================
   LOGIN
====================================================== */
const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    if (!['active', 'verified'].includes(user.profileStatus)) {
      return res.status(401).json({
        success: false,
        message: `Account is ${user.profileStatus}`,
      });
    }

    const token = generateToken(user._id, user.roles);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        location: {
          name: user.location?.name,
          coordinates: user.coordinates.coordinates,
        },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ======================================================
   GET PROFILE
====================================================== */
const getProfile = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.json({
    success: true,
    user,
  });
};

/* ======================================================
   UPDATE PROFILE (name / phone / location)
====================================================== */
const updateProfile = async (req, res) => {
  const { name, phone, location } = req.body;
  const update = {};

  if (name) update.name = name;
  if (phone) update.phone = phone;

  if (location) {
    const parsed = parseLocationData(location);
    update.location = parsed.location;
    update.coordinates = parsed.coordinates;
  }

  const user = await User.findByIdAndUpdate(req.user.id, update, {
    new: true,
    runValidators: true,
  });

  res.json({ success: true, user });
};

/* ======================================================
   UPDATE LOCATION (GPS ONLY)
====================================================== */
const updateLocation = async (req, res) => {
  const { lat, lng, name } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({
      success: false,
      message: 'Latitude and longitude are required',
    });
  }

  const user = await User.findByIdAndUpdate(
    req.user.id,
    {
      location: { name: name || 'Your Location' },
      coordinates: {
        type: 'Point',
        coordinates: [lng, lat],
      },
    },
    { new: true }
  );

  res.json({
    success: true,
    location: {
      name: user.location?.name,
      coordinates: user.coordinates.coordinates,
    },
  });
};

/* ======================================================
   NEARBY USERS (Geo Query)
====================================================== */
const getNearbyUsers = async (req, res) => {
  const { lat, lng, maxDistance = 5000 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({
      success: false,
      message: 'Latitude and longitude required',
    });
  }

  const users = await User.find({
    coordinates: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [Number(lng), Number(lat)],
        },
        $maxDistance: Number(maxDistance),
      },
    },
    profileStatus: { $in: ['active', 'verified'] },
  }).select('name roles location coordinates');

  res.json({ success: true, users });
};

/* ======================================================
   LOGOUT
====================================================== */
const logout = (req, res) => {
  res.json({ success: true, message: 'Logged out' });
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  updateLocation,
  getNearbyUsers,
  logout,
};

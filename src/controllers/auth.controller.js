const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { validationResult } = require('express-validator');

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

/**
 * Normalize location input into:
 * { location: {...}, coordinates: { type: 'Point', coordinates: [lng, lat] } }
 * Any county not in COUNTY_COORDS defaults to Nairobi coordinates.
 */
const parseLocationData = (location) => {
  const defaultCoords = COUNTY_COORDS['Nairobi'];

  let coordinates = { type: 'Point', coordinates: defaultCoords };
  let locationData = {};

  if (!location) return { location: locationData, coordinates };

  // CASE 1: GPS object { lat, lng, ... }
  if (typeof location === 'object' && typeof location.lat === 'number' && typeof location.lng === 'number') {
    coordinates.coordinates = [Number(location.lng), Number(location.lat)];
    locationData = {
      name: location.name || 'Your Location',
      address: {
        county: location.county || null,
        subCounty: location.subCounty || null,
        ward: location.ward || null,
        town: location.town || null,
        street: location.street || null,
      },
      landmark: location.landmark || null,
    };
    return { location: locationData, coordinates };
  }

  // CASE 2: Object with county info (no GPS)
  if (typeof location === 'object' && location.county) {
    const fallback = COUNTY_COORDS[location.county] || defaultCoords; // fallback to Nairobi if county not found
    coordinates.coordinates = fallback;
    locationData = {
      name: location.county,
      address: { county: location.county, town: location.town || null },
    };
    return { location: locationData, coordinates };
  }

  // CASE 3: Simple string
  if (typeof location === 'string') {
    const fallback = COUNTY_COORDS[location] || defaultCoords; // fallback to Nairobi
    coordinates.coordinates = fallback;
    locationData = { name: location };
    return { location: locationData, coordinates };
  }

  // Fallback
  return { location: {}, coordinates };
};


/* ======================================================
   REGISTER
====================================================== */
const register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, name, phone, roles, location } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ success: false, message: 'User already exists with this email' });

    const { location: loc, coordinates } = parseLocationData(location);

    // CLEAN coordinates for MongoDB
    const cleanCoordinates = {
      type: 'Point',
      coordinates: [Number(coordinates.coordinates[0]), Number(coordinates.coordinates[1])],
    };

    const user = await User.create({
      email,
      password,
      name,
      phone,
      roles: roles || ['farmer'],
      location: loc,
      coordinates: cleanCoordinates,
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
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (!['active', 'verified'].includes(user.profileStatus))
      return res.status(401).json({ success: false, message: `Account is ${user.profileStatus}` });

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
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  res.json({ success: true, user });
};

/* ======================================================
   UPDATE PROFILE
====================================================== */
const updateProfile = async (req, res) => {
  const { name, phone, location } = req.body;
  const update = {};
  if (name) update.name = name;
  if (phone) update.phone = phone;

  if (location) {
    const parsed = parseLocationData(location);
    update.location = parsed.location;
    update.coordinates = {
      type: 'Point',
      coordinates: [Number(parsed.coordinates.coordinates[0]), Number(parsed.coordinates.coordinates[1])],
    };
  }

  const user = await User.findByIdAndUpdate(req.user.id, update, { new: true, runValidators: true });
  res.json({ success: true, user });
};

/* ======================================================
   UPDATE LOCATION (GPS ONLY)
====================================================== */
const updateLocation = async (req, res) => {
  const { lat, lng, name } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number')
    return res.status(400).json({ success: false, message: 'Latitude and longitude are required' });

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { location: { name: name || 'Your Location' }, coordinates: { type: 'Point', coordinates: [Number(lng), Number(lat)] } },
    { new: true }
  );

  res.json({ success: true, location: { name: user.location?.name, coordinates: user.coordinates.coordinates } });
};

/* ======================================================
   NEARBY USERS
====================================================== */
const getNearbyUsers = async (req, res) => {
  const { lat, lng, maxDistance = 5000 } = req.query;
  if (!lat || !lng) return res.status(400).json({ success: false, message: 'Latitude and longitude required' });

  const users = await User.find({
    coordinates: { $near: { $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }, $maxDistance: Number(maxDistance) } },
    profileStatus: { $in: ['active', 'verified'] },
  }).select('name roles location coordinates');

  res.json({ success: true, users });
};

/* ======================================================
   LOGOUT
====================================================== */
const logout = (req, res) => res.json({ success: true, message: 'Logged out' });

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  updateLocation,
  getNearbyUsers,
  logout,
};
